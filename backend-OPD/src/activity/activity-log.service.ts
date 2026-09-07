import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { ActivityLog } from '../database/models';
import { ActivityAction, ActivityActor, UserType } from '../common/enums';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import type { AuthPatient } from '../patient-auth/current-patient.decorator';

/** One activity as the caller describes it; the service fills in the rest. */
export interface ActivityEntry {
  action: ActivityAction;
  summary: string;
  actor_type: ActivityActor;
  actor_id?: string | null;
  actor_label: string;
  doctor_id?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
}

/**
 * Written the instant they happen, never batched.
 *
 * The test is simple: would losing this row in a crash be a problem? For a
 * dictated prescription that reached a patient, or a login, the answer is yes
 * — those are the rows someone would later be asked to produce, and "the
 * server restarted" is not an acceptable reason for one to be missing. Routine
 * clinic traffic fails that test, so it batches.
 */
const WRITE_THROUGH: ReadonlySet<ActivityAction> = new Set([
  ActivityAction.LOGIN,
  ActivityAction.LOGIN_FAILED,
  ActivityAction.PASSWORD_CHANGED,
  ActivityAction.PATIENT_SIGNUP,
  ActivityAction.PATIENT_LOGIN,
  ActivityAction.PRESCRIPTION_ISSUED,
  ActivityAction.PRESCRIPTION_DELETED,
  ActivityAction.REPORT_UPLOADED,
  ActivityAction.REPORT_DELETED,
  ActivityAction.DOCTOR_REGISTERED,
  ActivityAction.DOCTOR_APPROVED,
  ActivityAction.DOCTOR_REJECTED,
  ActivityAction.DOCTOR_CREATED,
  ActivityAction.DOCTOR_DELETED,
  ActivityAction.USER_CREATED,
  ActivityAction.USER_DELETED,
]);

/** How long a batched row may sit in memory before it is written. */
const FLUSH_INTERVAL_MS = 5_000;

/** Flush early once this many are waiting, so a busy clinic writes sooner. */
const FLUSH_AT = 100;

/**
 * Above this, the buffer is dropping rows rather than growing without bound.
 * Only reachable if the database has been unreachable for a long stretch, and
 * a backlog large enough to threaten the process is worth less than the
 * process — an API that dies of its own audit log helps nobody.
 */
const MAX_BUFFER = 5_000;

/**
 * Records activity without making the database pay for every action.
 *
 * A write per action would put a second INSERT behind every request the clinic
 * makes — on the busiest tables, doubling write load to record work that was
 * already recorded. Routine rows are therefore collected in memory and written
 * in one `bulkCreate` every few seconds, which turns a hundred round trips into
 * one. Security and medical-record events skip the buffer entirely.
 *
 * Nothing here is allowed to affect the request that triggered it: `record()`
 * returns void, never throws, and is never awaited by callers.
 */
@Injectable()
export class ActivityLogService implements OnApplicationShutdown {
  private readonly logger = new Logger(ActivityLogService.name);
  private buffer: Partial<ActivityLog>[] = [];
  private readonly timer: NodeJS.Timeout;

  constructor(
    @InjectModel(ActivityLog) private readonly model: typeof ActivityLog,
  ) {
    this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    // Without unref() this interval alone would hold the event loop open and
    // stop the process from ever exiting on its own.
    this.timer.unref();
  }

  /**
   * Record one activity. Fire-and-forget by design — call it and move on.
   *
   * Deliberately not async: awaiting a log line puts the audit trail on the
   * critical path of the thing being audited, so a slow write would slow the
   * clinic down, and a failed one would fail a prescription that had already
   * been issued.
   */
  record(entry: ActivityEntry): void {
    const row: Partial<ActivityLog> = {
      actor_type: entry.actor_type,
      actor_id: entry.actor_id ?? null,
      actor_label: entry.actor_label.slice(0, 160),
      doctor_id: entry.doctor_id ?? null,
      action: entry.action,
      entity_type: entry.entity_type ?? null,
      entity_id: entry.entity_id ? String(entry.entity_id).slice(0, 80) : null,
      summary: entry.summary,
      metadata: entry.metadata ?? null,
      ip: entry.ip ?? null,
    };

    if (WRITE_THROUGH.has(entry.action)) {
      void this.write([row]);
      return;
    }

    if (this.buffer.length >= MAX_BUFFER) {
      this.logger.error(
        `Activity buffer is full (${MAX_BUFFER}); dropping "${entry.action}". ` +
          'The database has most likely been unreachable for some time.',
      );
      return;
    }

    this.buffer.push(row);
    if (this.buffer.length >= FLUSH_AT) void this.flush();
  }

  /** Convenience wrapper for a logged-in staff member. */
  recordForUser(
    user: AuthUser,
    entry: Omit<ActivityEntry, 'actor_type' | 'actor_id' | 'actor_label' | 'doctor_id'> &
      { doctor_id?: string | null },
  ): void {
    this.record({
      ...entry,
      actor_type: ActivityActor.USER,
      actor_id: user.id,
      actor_label: `${user.name} (${user.email})`,
      // A super admin acts on the platform, not inside one clinic, so their
      // rows carry the tenant only when the caller names one explicitly.
      doctor_id:
        entry.doctor_id !== undefined
          ? entry.doctor_id
          : user.type === UserType.SUPER_ADMIN
            ? null
            : user.doctorId,
    });
  }

  /** Convenience wrapper for a patient account (identified by mobile). */
  recordForPatient(
    patient: AuthPatient,
    entry: Omit<ActivityEntry, 'actor_type' | 'actor_id' | 'actor_label'>,
  ): void {
    this.record({
      ...entry,
      actor_type: ActivityActor.PATIENT,
      actor_id: patient.id,
      actor_label: patient.mobile,
    });
  }

  /**
   * Write everything currently buffered.
   *
   * The buffer is swapped out before the await, so rows arriving during the
   * insert queue up for the next pass instead of being written twice or lost
   * when this one returns.
   */
  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    await this.write(batch);
  }

  private async write(rows: Partial<ActivityLog>[]): Promise<void> {
    try {
      await this.model.bulkCreate(rows as any);
    } catch (err) {
      // Swallowed on purpose. Nothing that failed here is worth failing a
      // request over, and re-queueing a batch the database has just rejected
      // is how a transient outage turns into an unbounded retry loop.
      this.logger.warn(
        `Could not write ${rows.length} activity row(s): ${(err as Error).message}`,
      );
    }
  }

  /** Last chance to persist what is still in memory before the process ends. */
  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
  }
}
