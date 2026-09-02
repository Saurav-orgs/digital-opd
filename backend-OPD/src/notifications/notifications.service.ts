import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Notification } from '../database/models/notification.model';
import { NotificationType } from '../common/enums';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification) private readonly notificationModel: typeof Notification,
  ) {}

  async create(
    mobile: string,
    type: NotificationType,
    title: string,
    body?: string,
    data?: Record<string, unknown>,
    doctorId?: string | null,
    profileId?: string | null,
  ): Promise<Notification> {
    return this.notificationModel.create({
      patient_mobile: mobile,
      patient_profile_id: profileId ?? null,
      type,
      title,
      body: body ?? null,
      data: data ?? null,
      doctor_id: doctorId ?? null,
      read_at: null,
    } as any);
  }

  /**
   * Remove notifications of one type that point at a given prescription.
   *
   * Used when an issued prescription is withdrawn: the patient was told
   * "your prescription is ready", and leaving that in the bell would send them
   * looking for a document that is no longer there.
   */
  async removeForPrescription(
    prescriptionId: string,
    type: NotificationType,
  ): Promise<number> {
    return this.notificationModel.destroy({
      where: {
        type,
        // `data` is JSONB; match the key the issuing code writes.
        data: { prescriptionId } as any,
      },
    });
  }

  /**
   * `profileId` narrows to one family member; omit it for the account-wide
   * feed, which is what the bell icon shows.
   */
  async listForPatient(
    mobile: string,
    doctorId?: string | null,
    profileId?: string | null,
  ): Promise<Notification[]> {
    const where: any = { patient_mobile: mobile };
    if (profileId) where.patient_profile_id = profileId;
    if (doctorId) where.doctor_id = doctorId;
    return this.notificationModel.findAll({ where, order: [['created_at', 'DESC']] });
  }

  async unreadCount(mobile: string, doctorId?: string | null): Promise<number> {
    const where: any = { patient_mobile: mobile, read_at: null };
    if (doctorId) where.doctor_id = doctorId;
    return this.notificationModel.count({ where });
  }

  async markRead(mobile: string, id: string): Promise<void> {
    await this.notificationModel.update(
      { read_at: new Date() },
      { where: { id, patient_mobile: mobile, read_at: null } },
    );
  }

  async markAllRead(mobile: string): Promise<void> {
    await this.notificationModel.update(
      { read_at: new Date() },
      { where: { patient_mobile: mobile, read_at: null } },
    );
  }
}
