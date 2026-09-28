import workletUrl from './segmenter.worklet.js?url';

export const SAMPLE_RATE = 16000;

/**
 * How the recording is cut into pieces.
 *
 * These were chosen against a local Whisper, which pads every input to a
 * 30-second window — so a 3-second piece cost almost what a 20-second one did,
 * and long pieces were the economical choice. A hosted STT provider does not
 * pad and bills by audio length, so short pieces are now genuinely cheap, and
 * the backend transcribes several at once (CONSULTATION_PARALLEL_CHUNKS).
 *
 * `maxMs` is the one that matters most. It caps how much audio can still be
 * unheard when the doctor presses Stop — a doctor who talks for thirty seconds
 * without pausing used to leave up to twenty seconds of it outstanding, and
 * that wait is the whole reason they notice the feature at all.
 */
export const SEGMENT = {
  /** Never cut a piece shorter than this, however long the pause. */
  minMs: 2000,
  /** A pause this long, after minMs, ends the piece. */
  silenceMs: 600,
  /** Cut here regardless, so a doctor who never pauses still sees text. */
  maxMs: 8000,
};

/**
 * The microphone, cut into pieces at the pauses.
 *
 * Opens the mic, runs it through the segmenter worklet, and calls
 * `onSegment` with each piece as 16-bit 16 kHz PCM as soon as the doctor
 * pauses. `stop()` closes whatever piece is open and resolves once it has
 * been delivered, so the caller knows the last words are out.
 */
export interface Capture {
  stop(): Promise<void>;
}

export function isCaptureSupported(): boolean {
  return (
    typeof AudioContext !== 'undefined' &&
    typeof AudioWorkletNode !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

export async function startCapture(onSegment: (pcm: Int16Array) => void): Promise<Capture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  // Asked for 16 kHz so the worklet has nothing to resample; a browser that
  // will not run the graph at that rate gets a normal context and the
  // worklet resamples instead.
  let context: AudioContext;
  try {
    context = new AudioContext({ sampleRate: SAMPLE_RATE });
  } catch {
    context = new AudioContext();
  }
  await context.audioWorklet.addModule(workletUrl);

  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, 'segmenter', {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1,
    processorOptions: { targetRate: SAMPLE_RATE, ...SEGMENT },
  });

  let flushed: (() => void) | null = null;
  node.port.onmessage = (e: MessageEvent<{ type: string; pcm?: ArrayBuffer }>) => {
    if (e.data.type === 'segment' && e.data.pcm) onSegment(new Int16Array(e.data.pcm));
    if (e.data.type === 'flushed') flushed?.();
  };
  source.connect(node);
  // A suspended context (autoplay policy) produces nothing; make sure it runs.
  if (context.state !== 'running') await context.resume();

  return {
    stop: () =>
      new Promise<void>((resolve) => {
        flushed = () => {
          stream.getTracks().forEach((t) => t.stop());
          source.disconnect();
          node.disconnect();
          void context.close();
          resolve();
        };
        node.port.postMessage({ type: 'stop' });
      }),
  };
}
