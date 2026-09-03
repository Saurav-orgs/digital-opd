import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { consultationApi } from '../api/endpoints';
import type { ConsultationSession } from '../api/types';
import { useToast } from './Toast';
import { ConfirmDialog } from './ui';

const MIME_CANDIDATES = ['audio/webm', 'audio/mp4', 'audio/ogg'];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t));
}

const mmss = (total: number) =>
  `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;

/**
 * Records the OPD conversation and hands it to the server, which transcribes it
 * and drafts a prescription.
 *
 * Transcription takes minutes on local hardware, so the session is polled rather
 * than awaited — the doctor can carry on working while it runs.
 */
export function ConsultationRecorder({
  appointmentId,
  disabled,
}: {
  appointmentId: string;
  disabled?: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [confirmCancel, setConfirmCancel] = useState(false);
  /** Ticks while the server works, so "how long has this been going?" is answerable. */
  const [waited, setWaited] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  const sessionKey = ['consultation', appointmentId];

  const sessionQ = useQuery({
    queryKey: sessionKey,
    queryFn: () => consultationApi.session(appointmentId),
    // Poll while work is in flight (every 2 seconds).
    refetchInterval: (q) => {
      const s = q.state.data as ConsultationSession | null | undefined;
      return s?.status === 'transcribing' || s?.status === 'drafting' ? 2000 : false;
    },
  });

  const upload = useMutation({
    mutationFn: (audio: Blob) => consultationApi.uploadAudio(appointmentId, audio),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: sessionKey });
      toast.success('Recording sent', 'Writing the prescription draft…');
    },
    onError: (e) => toast.error(e),
  });

  const cancel = useMutation({
    mutationFn: () => consultationApi.cancelConsultation(appointmentId),
    onSuccess: async () => {
      setConfirmCancel(false);
      /*
       * Write the outcome into the cache rather than asking the server for it.
       *
       * A DELETE that came back OK means there is no session any more, and
       * that is not worth a round trip — depending on one is what left the
       * screen on "Transcribing" until a reload. The status poll runs every
       * two seconds, so one is almost always already in flight when the
       * cancel lands; it was issued before the row was deleted, so it answers
       * "transcribing", and a refetch asked for here is deduplicated into
       * that same request instead of starting a fresh one.
       *
       * `cancelQueries` first, so that in-flight poll cannot resolve
       * afterwards and put the old status back on screen.
       */
      await qc.cancelQueries({ queryKey: sessionKey });
      qc.setQueryData(sessionKey, null);
      toast.success(
        'Recording cancelled',
        'Nothing from it will be added — write the prescription below, or record again.',
      );
    },
    onError: (e) => { setConfirmCancel(false); toast.error(e); },
    // Whatever happened above, end up agreeing with the server. This request
    // is issued after the delete, so it cannot carry a pre-cancel answer.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: sessionKey });
    },
  });

  // Invalidate prescription query immediately when draft is ready
  useEffect(() => {
    if (sessionQ.data?.status === 'draft_ready') {
      qc.invalidateQueries({ queryKey: ['prescription', appointmentId] });
    }
  }, [sessionQ.data?.status, appointmentId, qc]);

  // Release the microphone if the modal closes mid-recording.
  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast.error(new Error('This browser cannot record audio. Try Chrome or Safari.'));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // High clarity recording with noise suppression and auto gain
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
        },
      });
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType, audioBitsPerSecond: 128000 } : { audioBitsPerSecond: 128000 },
      );
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, {
          type: mimeType || 'audio/webm',
        });
        if (blob.size > 0) upload.mutate(blob);
      };

      recorder.start(1000);
      recorderRef.current = recorder;
      setRecording(true);
      setElapsed(0);
      timerRef.current = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch {
      toast.error(
        new Error('Microphone permission was denied. Allow it in the browser and retry.'),
      );
    }
  };

  const stop = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const session = sessionQ.data;
  /** Server-side work only — the upload is a separate, client-side wait. */
  const processing =
    session?.status === 'transcribing' || session?.status === 'drafting';
  const busy = upload.isPending || processing;

  /*
   * Count from when the server took the recording, not from when this screen
   * opened: the doctor can leave the appointment and come back, and a wait
   * that restarts at 0:00 each time hides exactly the thing they are trying
   * to judge.
   */
  useEffect(() => {
    if (!processing) {
      setWaited(0);
      return;
    }
    const started = session?.createdAt ?? session?.created_at;
    const startedAt = started ? new Date(started).getTime() : Date.now();
    const tick = () =>
      setWaited(Math.max(0, Math.round((Date.now() - startedAt) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [processing, session?.createdAt, session?.created_at]);

  // Long enough that a healthy run has normally finished, so the nudge means
  // something when it appears rather than crying wolf on every recording.
  const looksStuck = processing && waited >= 180;

  return (
    <div>
      <div className="row" style={{ alignItems: 'center', gap: 12 }}>
        {!recording ? (
          <button
            className="btn btn-primary btn-sm"
            disabled={disabled || busy}
            onClick={start}
          >
            🎙 Start listening
          </button>
        ) : (
          <button className="btn btn-danger btn-sm" onClick={stop}>
            ■ Stop listening
          </button>
        )}

        {recording && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--state-error)',
                display: 'inline-block',
              }}
            />
            Recording · {mmss(elapsed)}
          </span>
        )}

        {!recording && busy && (
          <span className="muted" style={{ fontSize: 13 }}>
            {upload.isPending
              ? 'Uploading the recording…'
              : session?.status === 'transcribing'
                ? 'Transcribing — this can take a few minutes on this machine.'
                : 'Writing the prescription draft…'}
            {processing && ` · ${mmss(waited)}`}
          </span>
        )}

        {/*
          Transcription can genuinely take minutes here, and a model that has
          wedged looks identical to one that is merely slow — only the doctor
          can decide it has gone on long enough. Without this the visit is
          stuck: the recorder stays busy and there is no way back to writing.
        */}
        {!recording && processing && (
          <button
            className="btn btn-sm"
            style={{ color: 'var(--state-error)', marginLeft: 'auto' }}
            disabled={cancel.isPending}
            onClick={() => setConfirmCancel(true)}
            title="Stop waiting and write the prescription yourself"
          >
            {cancel.isPending ? 'Cancelling…' : '✕ Cancel'}
          </button>
        )}
      </div>

      {looksStuck && (
        <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
          This is taking longer than usual. You can cancel and write the
          prescription below — the recording will be discarded.
        </div>
      )}

      {confirmCancel && (
        <ConfirmDialog
          title="Cancel this recording?"
          destructive
          busy={cancel.isPending}
          confirmLabel="Cancel recording"
          cancelLabel="Keep waiting"
          message={
            <>
              The recording is discarded and no draft will be created from it.
              Anything you have already typed into the prescription below stays
              exactly as it is.
              <br />
              <br />
              You can record again afterwards if you want to.
            </>
          }
          onConfirm={() => cancel.mutate()}
          onCancel={() => setConfirmCancel(false)}
        />
      )}

      {session?.status === 'failed' && (
        <div
          style={{
            marginTop: 10,
            padding: '8px 10px',
            borderRadius: 8,
            background: '#fdecec',
            color: 'var(--state-error)',
            fontSize: 12.5,
          }}
        >
          Couldn’t process the recording: {session.error}
          <div style={{ marginTop: 4, color: 'var(--text)' }}>
            You can still write the prescription by hand below.
          </div>
        </div>
      )}

      {session?.status === 'draft_ready' && (
        <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
          Draft ready below — please check every line before issuing.
        </div>
      )}

      {session?.transcript && (
        <details style={{ marginTop: 10 }}>
          <summary className="muted" style={{ fontSize: 12.5, cursor: 'pointer' }}>
            What the system heard
          </summary>
          <p
            style={{
              whiteSpace: 'pre-wrap',
              fontSize: 13,
              marginTop: 8,
              padding: 10,
              background: 'var(--page)',
              borderRadius: 8,
            }}
          >
            {session.transcript}
          </p>
        </details>
      )}
    </div>
  );
}
