import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { consultationApi } from '../api/endpoints';
import type { ConsultationSession } from '../api/types';
import { useToast } from './Toast';

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
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  const sessionQ = useQuery({
    queryKey: ['consultation', appointmentId],
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
      qc.invalidateQueries({ queryKey: ['consultation', appointmentId] });
      toast.success('Recording sent', 'Writing the prescription draft…');
    },
    onError: (e) => toast.error(e),
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
  const busy =
    upload.isPending ||
    session?.status === 'transcribing' ||
    session?.status === 'drafting';

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
          </span>
        )}
      </div>

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
