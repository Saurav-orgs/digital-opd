import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Shapes returned by the local sidecar (see ai-OPD/app/schemas.py). */
export interface AiAbnormalValue {
  label: string;
  value: string;
  reference?: string;
  direction: 'high' | 'low' | 'abnormal';
}

export interface AiReportSummary {
  report_type: string;
  summary: string;
  key_findings: string[];
  abnormal_values: AiAbnormalValue[];
}

export interface AiDraftMedicine {
  name: string;
  strength?: string;
  form?: string;
  dosage?: string;
  timing?: string;
  duration_days?: number | null;
  instructions?: string;
}

export interface AiDraftPrescription {
  diagnosis: string;
  medicines: AiDraftMedicine[];
  advice: string[];
  follow_up_days?: number | null;
}

export interface AiProgressTrend {
  label: string;
  previous_value: string;
  current_value: string;
  direction: 'up' | 'down' | 'same';
  interpretation: 'better' | 'worse' | 'unclear';
}

export interface AiProgressSummary {
  status: 'improving' | 'stable' | 'worsening' | 'unclear';
  summary: string;
  improvements: string[];
  deteriorations: string[];
  unchanged: string[];
  trends: AiProgressTrend[];
  current_status: string;
  watch_points: string[];
}

export interface AiProgressResult {
  summary: AiProgressSummary;
  visit_count: number;
  model_version: string;
}

/** One visit's already-computed report summaries, as sent for comparison. */
export interface AiVisitInput {
  visit_date: string;
  reports: {
    title: string;
    summary: string;
    key_findings: string[];
    abnormal_values: AiAbnormalValue[];
  }[];
}

export interface AiConsolidatedSummary {
  summary: AiReportSummary;
  source_count: number;
  model_version: string;
}

export interface AiTranscript {
  text: string;
  language: string;
  duration_seconds: number;
  model_version: string;
}

/** Thrown when the sidecar is unreachable or cannot produce a result. */
export class AiUnavailableError extends Error {}

/**
 * Thin HTTP client for the local inference sidecar (ai-OPD).
 *
 * Every method either returns a result or throws `AiUnavailableError` — callers
 * are expected to catch it and degrade rather than fail the user's request. The
 * AI is an assist, never a prerequisite: a report still uploads and a
 * consultation still records when this service is down.
 */
@Injectable()
export class AiClientService {
  private readonly logger = new Logger(AiClientService.name);
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;

  constructor(private readonly config: ConfigService) {
    const ai = this.config.get<{ url: string; timeoutSeconds: number }>('ai')!;
    this.baseUrl = ai.url.replace(/\/$/, '');
    this.requestTimeoutMs = ai.timeoutSeconds * 1000;
  }

  /** True when the sidecar answers and has its models loaded. */
  async isHealthy(): Promise<boolean> {
    try {
      const res = await this.fetchWithTimeout(`${this.baseUrl}/health`, {}, 5000);
      if (!res.ok) return false;
      const body = (await res.json()) as { status?: string };
      return body.status === 'ok';
    } catch {
      return false;
    }
  }

  /** Transcribe consultation audio. The sidecar never persists the audio. */
  async transcribe(
    audio: Express.Multer.File,
    medicineCatalog: string[] = [],
  ): Promise<AiTranscript> {
    const form = new FormData();
    form.append(
      'audio',
      new Blob([new Uint8Array(audio.buffer)], {
        type: audio.mimetype || 'application/octet-stream',
      }),
      audio.originalname || 'consultation.webm',
    );
    form.append('medicine_catalog', JSON.stringify(medicineCatalog));

    return this.postForm<AiTranscript>('/transcribe', form);
  }

  /** Summarise an uploaded report (PDF or photo). */
  async summarizeReport(
    file: Express.Multer.File,
  ): Promise<{ summary: AiReportSummary; model_version: string }> {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(file.buffer)], {
        type: file.mimetype || 'application/octet-stream',
      }),
      file.originalname || 'report',
    );

    return this.postForm<{ summary: AiReportSummary; model_version: string }>(
      '/summarize-report',
      form,
    );
  }

  /** Combine several per-report summaries into one overview for a visit. */
  async consolidateSummaries(
    reports: {
      title: string;
      summary: string;
      key_findings: string[];
      abnormal_values: AiAbnormalValue[];
    }[],
  ): Promise<AiConsolidatedSummary> {
    const res = await this.fetchWithTimeout(
      `${this.baseUrl}/summarize-reports`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reports }),
      },
      this.requestTimeoutMs,
    ).catch((err) => {
      throw this.unreachable(err);
    });

    return this.parse<AiConsolidatedSummary>(res, '/summarize-reports');
  }

  /**
   * Compare the patient's previous visit against this one. Text in, text out —
   * both visits arrive already summarised, so there is no OCR and this is far
   * quicker than summarising a report.
   */
  async summarizeProgress(body: {
    patient: { age?: number | null; gender?: string };
    previous: AiVisitInput;
    current: AiVisitInput;
  }): Promise<AiProgressResult> {
    const res = await this.fetchWithTimeout(
      `${this.baseUrl}/summarize-progress`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      this.requestTimeoutMs,
    ).catch((err) => {
      throw this.unreachable(err);
    });

    return this.parse<AiProgressResult>(res, '/summarize-progress');
  }

  /** Draft a prescription from a consultation transcript. */
  async extractPrescription(body: {
    transcript: string;
    patient: {
      name?: string;
      age?: number | null;
      gender?: string;
      complaint?: string;
    };
    medicine_catalog: string[];
  }): Promise<{ prescription: AiDraftPrescription; model_version: string }> {
    const res = await this.fetchWithTimeout(
      `${this.baseUrl}/extract-prescription`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      this.requestTimeoutMs,
    ).catch((err) => {
      throw this.unreachable(err);
    });

    return this.parse(res, '/extract-prescription');
  }

  // ── internals ──────────────────────────────────────────────

  private async postForm<T>(path: string, form: FormData): Promise<T> {
    const res = await this.fetchWithTimeout(
      `${this.baseUrl}${path}`,
      { method: 'POST', body: form },
      this.requestTimeoutMs,
    ).catch((err) => {
      throw this.unreachable(err);
    });

    return this.parse<T>(res, path);
  }

  private async parse<T>(res: Response, path: string): Promise<T> {
    if (!res.ok) {
      // The sidecar puts a readable reason in FastAPI's `detail`.
      const detail = await res
        .json()
        .then((b: any) => b?.detail)
        .catch(() => null);
      const message = detail || `AI service returned HTTP ${res.status}`;
      this.logger.warn(`${path} failed: ${message}`);
      throw new AiUnavailableError(message);
    }
    return (await res.json()) as T;
  }

  private unreachable(err: unknown): AiUnavailableError {
    const reason =
      (err as Error)?.name === 'TimeoutError'
        ? 'the AI service took too long to respond'
        : `the AI service is not reachable at ${this.baseUrl}`;
    this.logger.warn(`AI request failed — ${reason}`);
    return new AiUnavailableError(reason);
  }

  private fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  }
}
