import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { API_BASE, tokenStore } from '../api/client';
import type { ConsultationSession, ConsultationStatusAi } from '../api/types';

/** The socket lives on the API host, next to `/api`, not under it. */
const SOCKET_ORIGIN = new URL(API_BASE, window.location.href).origin;

type Refusal = { ok: false; message: string; fatal: boolean };
type Ack<T> = ({ ok: true } & T) | Refusal;

/** How long to wait for the server before deciding streaming is not on. */
const CONNECT_TIMEOUT_MS = 5000;

export interface ConsultationStream {
  /**
   * Open a live session for this appointment. Resolves `true` when the
   * server took it; `false` means live transcription is not available right
   * now and the caller should keep the audio for the upload path instead.
   * Never throws — the fallback is the point.
   */
  start(appointmentId: string): Promise<boolean>;
  /** One piece of the recording, as a WAV. Ignored once the stream has failed. */
  sendSegment(wav: ArrayBuffer): void;
  /**
   * The doctor stopped. Resolves `true` when the server accepted the hand-off
   * (the last piece and the draft are its job now), `false` when the caller
   * must upload the recording the old way.
   */
  stop(): Promise<boolean>;
  /** The doctor gave up on this recording. */
  abort(): Promise<void>;
  /** The text so far, as the server hears it. */
  transcript: string;
  /** True while a session is open and healthy. */
  live: boolean;
}

/**
 * Live transcription over the `/consultation` socket.
 *
 * Owns one socket for the life of the recorder, and writes what comes back
 * into the same react-query cache the rest of the page reads the session
 * from — the transcript grows in place and the status walks recording →
 * transcribing → drafting → draft_ready without a poll having to notice.
 *
 * Any failure anywhere marks the stream dead rather than surfacing an error:
 * the recorder keeps recording regardless and uploads the whole thing when
 * the doctor stops, exactly as it did before streaming existed.
 */
export function useConsultationStream(appointmentId: string): ConsultationStream {
  const qc = useQueryClient();
  const socketRef = useRef<Socket | null>(null);
  const seqRef = useRef(0);
  const deadRef = useRef(false);
  const [live, setLive] = useState(false);
  const [transcript, setTranscript] = useState('');

  const sessionKey = ['consultation', appointmentId];

  const patchSession = useCallback(
    (patch: Partial<ConsultationSession>) => {
      qc.setQueryData<ConsultationSession | null>(sessionKey, (prev) =>
        prev ? { ...prev, ...patch } : ({ appointment_id: appointmentId, ...patch } as ConsultationSession),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appointmentId, qc],
  );

  const kill = useCallback(() => {
    deadRef.current = true;
    setLive(false);
    socketRef.current?.disconnect();
    socketRef.current = null;
  }, []);

  useEffect(() => () => kill(), [kill]);

  const start = useCallback(
    async (id: string): Promise<boolean> => {
      deadRef.current = false;
      seqRef.current = 0;
      setTranscript('');

      const socket = io(`${SOCKET_ORIGIN}/consultation`, {
        auth: { token: tokenStore.get() },
        // Long-polling first would hold the segments in HTTP requests; the
        // socket is the whole point, so ask for it outright.
        transports: ['websocket'],
        reconnection: false,
        timeout: CONNECT_TIMEOUT_MS,
      });
      socketRef.current = socket;

      socket.on('transcript', (m: { transcript: string }) => {
        setTranscript(m.transcript);
        patchSession({ transcript: m.transcript });
      });
      socket.on('status', (m: { status: ConsultationStatusAi; error: string | null }) => {
        patchSession({ status: m.status, error: m.error });
        if (m.status === 'draft_ready' || m.status === 'failed') {
          // The row is the truth from here; fetch it and the draft it made.
          void qc.invalidateQueries({ queryKey: sessionKey });
          void qc.invalidateQueries({ queryKey: ['prescription', id] });
          kill();
        }
      });
      socket.on('error', (m: { fatal?: boolean }) => {
        if (m?.fatal) kill();
      });
      // A dropped socket mid-recording cannot be resumed — the server has
      // the pieces so far, but not what comes next. The recorder still has
      // all of it and uploads the lot on stop.
      socket.on('disconnect', () => {
        if (socketRef.current === socket) kill();
      });

      const connected = await new Promise<boolean>((resolve) => {
        const timer = window.setTimeout(() => resolve(false), CONNECT_TIMEOUT_MS);
        socket.once('connect', () => {
          window.clearTimeout(timer);
          resolve(true);
        });
        socket.once('connect_error', () => {
          window.clearTimeout(timer);
          resolve(false);
        });
      });
      if (!connected || deadRef.current) {
        kill();
        return false;
      }

      const ack = await new Promise<Ack<{ sessionId: string }> | null>((resolve) => {
        const timer = window.setTimeout(() => resolve(null), CONNECT_TIMEOUT_MS);
        socket.emit('start', { appointmentId: id }, (a: Ack<{ sessionId: string }>) => {
          window.clearTimeout(timer);
          resolve(a);
        });
      });
      if (!ack || !ack.ok) {
        kill();
        return false;
      }

      patchSession({ status: 'recording', transcript: '', error: null });
      setLive(true);
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kill, patchSession, qc],
  );

  const sendSegment = useCallback((wav: ArrayBuffer) => {
    const socket = socketRef.current;
    if (!socket || deadRef.current) return;
    const seq = seqRef.current++;
    socket.emit('segment', { seq, wav }, (a: Ack<object>) => {
      if (!a?.ok && a?.fatal) kill();
    });
  }, [kill]);

  const stop = useCallback(async (): Promise<boolean> => {
    const socket = socketRef.current;
    if (!socket || deadRef.current) return false;
    const ack = await new Promise<Ack<object> | null>((resolve) => {
      const timer = window.setTimeout(() => resolve(null), CONNECT_TIMEOUT_MS);
      socket.emit('stop', { totalSegments: seqRef.current }, (a: Ack<object>) => {
        window.clearTimeout(timer);
        resolve(a);
      });
    });
    if (!ack || !ack.ok) {
      kill();
      return false;
    }
    // The socket stays open for the status events; `kill` runs on the last one.
    return true;
  }, [kill]);

  const abort = useCallback(async () => {
    const socket = socketRef.current;
    if (socket && !deadRef.current) {
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, CONNECT_TIMEOUT_MS);
        socket.emit('abort', {}, () => {
          window.clearTimeout(timer);
          resolve();
        });
      });
    }
    kill();
  }, [kill]);

  return { start, sendSegment, stop, abort, transcript, live };
}
