import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { consultationApi } from '../api/endpoints';
import type { ConsultationSession } from '../api/types';
import { useToast } from './Toast';
import { flushDraft, type DraftFlushRef } from '../lib/draftFlush';
import { isCaptureSupported, startCapture, SAMPLE_RATE, type Capture } from '../lib/audio/capture';
import { concatPcm, pcmToWav } from '../lib/audio/wav';
import { useConsultationStream } from '../lib/consultationStream';
import { ConfirmDialog } from './ui';
import { MicIcon, StopIcon } from './icons';

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
 * Two ways in, same outcome:
 *
 *  - **Live.** The mic is cut into pieces at the pauses and each piece goes
 *    to the server over a socket while the doctor is still talking; the
 *    transcript shows up under the mic as it is heard, and when they stop
 *    only the last few seconds are left to transcribe before the draft.
 *  - **Upload.** The whole recording goes up when they stop, and the session
 *    is polled while the server works through it. This is what runs when the
 *    socket cannot be had — server has streaming off, the connection dropped,
 *    the browser has no AudioWorklet — and it is never announced: the doctor
 *    just waits a little longer.
 *
 * Whichever way, the recording is kept here until the server has it in full,
 * so nothing said is lost to a bad connection.
 */
export function ConsultationRecorder({
  appointmentId,
  disabled,
  onBusyChange,
  flushRef,
}: {
  appointmentId: string;
  disabled?: boolean;
  /**
   * The editor's "save what I hold" hook, when it is on screen under the
   * microphone. A second recording adds to the draft rather than replacing
   * it, so the draft the server adds to has to be the one the doctor is
   * looking at — including a Clear all they pressed a moment ago.
   */
  flushRef?: DraftFlushRef;
  /**
   * Told when the doctor is mid-dictation or the recording is still on its
   * way up. Server-side work after that (transcribing, drafting) is visible
   * to anyone through the session query; this covers only what lives here.
   */
  onBusyChange?: (busy: boolean) => void;
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
  /** The live path: the worklet capture and every piece it has produced. */
  const captureRef = useRef<Capture | null>(null);
  const piecesRef = useRef<Int16Array[]>([]);
  /** Resolves once the server has (or has refused) the live session. */
  const streamStartRef = useRef<Promise<boolean> | null>(null);
  const [stopping, setStopping] = useState(false);

  const stream = useConsultationStream(appointmentId);
  const sessionKey = ['consultation', appointmentId];

  const sessionQ = useQuery({
    queryKey: sessionKey,
    queryFn: () => consultationApi.session(appointmentId),
    // Poll while work is in flight (every 2 seconds).
    refetchInterval: (q) => {
      const s = q.state.data as ConsultationSession | null | undefined;
      // While live, the socket is the source of truth; the poll is only a
      // net under it (a refresh, a missed event) and runs slower.
      if (s?.status === 'recording') return stream.live ? 10000 : 2000;
      return s?.status === 'transcribing' || s?.status === 'drafting' ? 2000 : false;
    },
  });

  const upload = useMutation({
    mutationFn: async (audio: Blob) => {
      await flushDraft(flushRef);
      return consultationApi.uploadAudio(appointmentId, audio);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: sessionKey });
      toast.success('Recording sent', 'Writing the prescription draft…');
    },
    onError: (e) => toast.error(e),
  });

  const cancel = useMutation({
    mutationFn: async () => {
      // A live session is torn down through the socket as well, so the
      // server drops the piece it is on instead of finishing it into a row
      // that is about to be deleted.
      await stream.abort();
      return consultationApi.cancelConsultation(appointmentId);
    },
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

  const retry = useMutation({
    mutationFn: () => consultationApi.retryDraft(appointmentId),
    onSuccess: async (session) => {
      /*
       * Same reasoning as the cancel above: a poll issued before this request
       * is very likely still in flight, and it would answer "failed" — putting
       * the error box straight back over a retry that is actually running.
       * Cancel those first, then write the session the server just returned.
       */
      await qc.cancelQueries({ queryKey: sessionKey });
      qc.setQueryData(sessionKey, session);
      toast.success(
        'Trying again',
        'Writing the prescription from what was already heard.',
      );
    },
    onError: (e) => toast.error(e),
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
      void captureRef.current?.stop();
    };
  }, []);

  const beginTimer = () => {
    setRecording(true);
    setElapsed(0);
    timerRef.current = window.setInterval(() => setElapsed((s) => s + 1), 1000);
  };

  /**
   * The live path. The mic goes through the segmenter from the first
   * second; whether the pieces also go to the server is decided by whether
   * the socket comes up, and it comes up in parallel so the doctor never
   * waits on it. Every piece is kept here regardless — that is the upload
   * of last resort.
   */
  const startLive = async () => {
    piecesRef.current = [];
    // Editor state first, for the same reason the upload path saves it: the
    // draft the server adds to must be the one on screen.
    await flushDraft(flushRef);

    // The mic before the session: a session is a row on the server that
    // says "recording", and until the microphone is actually open there is
    // nothing being recorded. Opened the other way round, a refused mic
    // left an empty session spinning on "Transcribing…" with nothing to
    // transcribe. Pieces cut in the gap before the server answers wait on
    // this promise and go up with the rest once it has.
    let serverAnswered: (ok: boolean) => void = () => {};
    streamStartRef.current = new Promise<boolean>((resolve) => {
      serverAnswered = resolve;
    });
    try {
      captureRef.current = await startCapture((pcm) => {
        piecesRef.current.push(pcm);
        void streamStartRef.current?.then((ok) => {
          if (ok) stream.sendSegment(pcmToWav(pcm, SAMPLE_RATE));
        });
      });
    } catch (err) {
      serverAnswered(false);
      throw err;
    }
    beginTimer();
    void stream.start(appointmentId).then(serverAnswered);
  };

  const stopLive = async () => {
    setStopping(true);
    try {
      const capture = captureRef.current;
      captureRef.current = null;
      // Waits for the last piece to be cut and handed over before asking
      // the server to finish, so `totalSegments` counts it.
      await capture?.stop();
      const accepted = (await streamStartRef.current) && (await stream.stop());
      if (accepted) {
        toast.success('Recording sent', 'Writing the prescription draft…');
        return;
      }
      // No live session, or it died on the way: everything said is still
      // here, so it goes up the old way and the server starts from scratch.
      const pcm = concatPcm(piecesRef.current);
      if (pcm.length > 0) {
        upload.mutate(new Blob([pcmToWav(pcm, SAMPLE_RATE)], { type: 'audio/wav' }));
      } else {
        toast.error(new Error('Nothing was heard. Please check the microphone and try again.'));
      }
    } finally {
      piecesRef.current = [];
      setStopping(false);
    }
  };

  const start = async () => {
    if (isCaptureSupported()) {
      try {
        await startLive();
      } catch {
        toast.error(
          new Error('Microphone permission was denied. Allow it in the browser and retry.'),
        );
      }
      return;
    }
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
      beginTimer();
    } catch {
      toast.error(
        new Error('Microphone permission was denied. Allow it in the browser and retry.'),
      );
    }
  };

  const stop = () => {
    setRecording(false);
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (captureRef.current) {
      void stopLive();
      return;
    }
    recorderRef.current?.stop();
    recorderRef.current = null;
  };

  const session = sessionQ.data;
  /** Server-side work only — the upload is a separate, client-side wait. */
  const processing =
    session?.status === 'transcribing' ||
    session?.status === 'drafting' ||
    // Live session still open after Stop: the server has the pieces and is
    // on the last one. (While the mic is on, `recording` covers this.)
    (session?.status === 'recording' && !recording);
  const busy = upload.isPending || stopping || processing;

  // What only this component knows: the mic is open, or the audio is
  // uploading. Cleared on unmount so a tab switch does not leave the page
  // thinking a recording is still running.
  const localBusy = recording || stopping || upload.isPending;
  useEffect(() => {
    onBusyChange?.(localBusy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localBusy]);
  useEffect(() => () => onBusyChange?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps

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

  /*
   * What the button is for, in one line, under the mic. The recorder has four
   * states the doctor has to be able to tell apart at a glance — idle,
   * listening, uploading, and the server thinking — and the design gives it
   * one line of text to do it in.
   */
  const status = recording
    ? stream.live
      ? 'Listening… (live)'
      : 'Listening…'
    : stopping
      ? 'Finishing the recording…'
      : upload.isPending
        ? 'Uploading the recording…'
        : session?.status === 'transcribing' || session?.status === 'recording'
          ? 'Transcribing…'
          : session?.status === 'drafting'
            ? 'Writing the draft…'
            : 'Tap to start recording';

  // Live text shown under the mic: the transcript as the server hears it,
  // from the first piece until the draft is on screen. Afterwards the same
  // text folds into "What the system heard" below. The socket feeds it
  // directly; after a refresh mid-consultation the polled row does instead.
  const liveText =
    stream.transcript ||
    (session?.status === 'recording' || processing ? (session?.transcript ?? '') : '');
  const showLive = (recording || busy) && (stream.live || liveText.length > 0);

  return (
    <div>
      {/*
        The design's mic: one big round button in the middle of the card, not a
        pill in a toolbar. Recording is the whole purpose of this panel, so it
        gets the middle of it.
      */}
      <div className="mic-wrap">
        {/*
          From the moment the doctor taps stop until the draft is on screen
          the mic goes away entirely. A greyed-out mic next to "Writing the
          draft…" read as "tap again" — doctors tapped it, nothing happened,
          and they were not sure whether the recording had been taken. The
          spinner says the system has it; the only control is Cancel.
        */}
        {!recording && busy ? (
          <div className="mic-busy" role="status" aria-live="polite" aria-label={status}>
            <span className="spinner" aria-hidden />
          </div>
        ) : (
          <button
            className={`mic-btn ${recording ? 'recording' : ''}`}
            disabled={disabled}
            onClick={recording ? stop : start}
            aria-label={recording ? 'Stop recording' : 'Start recording'}
            title={recording ? 'Stop recording' : 'Start recording'}
          >
            {recording ? <StopIcon size={22} /> : <MicIcon size={24} />}
          </button>
        )}

        <div className="mic-status">{status}</div>
        {(recording || processing) && (
          <div className="mic-timer">{mmss(recording ? elapsed : waited)}</div>
        )}
        {/* The stop control is the same round button that started it, which
            is not obvious mid-recording — say so under the clock. */}
        {recording && <div className="mic-hint">Tap to stop recording</div>}

        {/*
          Transcription can genuinely take minutes here, and a model that has
          wedged looks identical to one that is merely slow — only the doctor
          can decide it has gone on long enough. Without this the visit is
          stuck: the recorder stays busy and there is no way back to writing.
        */}
        {!recording && processing && (
          <button
            className="btn btn-sm mic-cancel"
            disabled={cancel.isPending}
            onClick={() => setConfirmCancel(true)}
            title="Stop waiting and write the prescription yourself"
          >
            {cancel.isPending ? 'Cancelling…' : 'Cancel'}
          </button>
        )}
      </div>

      {showLive && (
        <div className="live-transcript" aria-live="polite">
          <div className="live-transcript-label">
            {recording ? 'Hearing…' : 'Heard so far'}
          </div>
          <p className="live-transcript-text">
            {liveText || <span className="muted">Waiting for the first words…</span>}
            {recording && <span className="live-cursor" aria-hidden />}
          </p>
        </div>
      )}

      {looksStuck && (
        <div className="muted" style={{ fontSize: 12.5, marginTop: 8, textAlign: 'center' }}>
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
          {/*
            * Offered only when there is a transcript to draft from. These
            * failures are usually transient — the AI service restarting, a
            * deploy, a timeout — and the recording has already been
            * transcribed by the time this shows, so re-running the draft
            * costs seconds. Without it the doctor's only route is to ask the
            * patient to say the whole consultation again, with what was heard
            * visible on the very same screen.
            */}
          {session.transcript?.trim() ? (
            <div
              style={{
                marginTop: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <button
                className="btn btn-primary btn-sm"
                disabled={retry.isPending || disabled}
                onClick={() => retry.mutate()}
                title="Draft the prescription again from what was already heard"
              >
                {retry.isPending ? 'Trying again…' : '↻ Try again'}
              </button>
              <span style={{ color: 'var(--text)' }}>
                Uses what was already heard — no need to record again.
              </span>
            </div>
          ) : null}
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

      {session?.transcript && !showLive && (
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
