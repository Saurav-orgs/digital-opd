/**
 * Cuts a live microphone feed into pieces at the pauses in speech.
 *
 * Runs on the audio thread. Plain JavaScript on purpose: the file is loaded
 * by URL with `audioWorklet.addModule`, outside the bundle, so it has to be
 * something the browser can run as-is.
 *
 * Every 128-frame block that arrives is resampled to 16 kHz (what Whisper
 * wants) and appended to the piece being built. The piece is closed and
 * posted to the main thread when the doctor has been talking for at least
 * `minMs` and then goes quiet for `silenceMs`, or unconditionally at `maxMs`
 * so a doctor who never pauses still sees text appear. A piece that held no
 * speech at all is dropped rather than sent — it would cost a model call and
 * come back empty.
 *
 * Messages out:   { type: 'segment', pcm: ArrayBuffer }   16-bit mono 16 kHz
 *                 { type: 'flushed' }                      after 'stop'
 * Messages in:    { type: 'stop' }                         close what is open
 */
class SegmenterProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.targetRate = opts.targetRate || 16000;
    this.minMs = opts.minMs || 3000;
    this.silenceMs = opts.silenceMs || 600;
    this.maxMs = opts.maxMs || 20000;

    this.chunks = [];
    this.samples = 0;
    this.speechSamples = 0;
    this.quietSamples = 0;
    this.floor = 0.004; // running estimate of the room's noise level
    this.resampleCursor = 0;
    this.stopped = false;

    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'stop') {
        this.stopped = true;
        this.close();
        this.port.postMessage({ type: 'flushed' });
      }
    };
  }

  process(inputs) {
    if (this.stopped) return false;
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const frame = input[0];

    // Loudness of this block, before resampling, on the raw signal.
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const rms = Math.sqrt(sum / frame.length);

    // The floor drifts down quickly and up slowly, so it settles on the
    // quiet between words rather than on the words. Speech is anything
    // clearly above it.
    if (rms < this.floor) this.floor = this.floor * 0.9 + rms * 0.1;
    else this.floor = this.floor * 0.995 + rms * 0.005;
    const speaking = rms > Math.max(0.012, this.floor * 3);

    const out = this.resample(frame);
    this.chunks.push(out);
    this.samples += out.length;
    if (speaking) {
      this.speechSamples += out.length;
      this.quietSamples = 0;
    } else {
      this.quietSamples += out.length;
    }

    const ms = (this.samples / this.targetRate) * 1000;
    const quietMs = (this.quietSamples / this.targetRate) * 1000;
    if (ms >= this.maxMs || (ms >= this.minMs && this.speechSamples > 0 && quietMs >= this.silenceMs)) {
      this.close();
    }
    return true;
  }

  /** Post the piece being built, unless nothing was said in it. */
  close() {
    if (this.speechSamples > 0 && this.samples > 0) {
      const pcm = new Int16Array(this.samples);
      let offset = 0;
      for (const c of this.chunks) {
        pcm.set(c, offset);
        offset += c.length;
      }
      this.port.postMessage({ type: 'segment', pcm: pcm.buffer }, [pcm.buffer]);
    }
    this.chunks = [];
    this.samples = 0;
    this.speechSamples = 0;
    this.quietSamples = 0;
  }

  /** Float32 at the context's rate → Int16 at the target rate, by linear interpolation. */
  resample(frame) {
    const ratio = sampleRate / this.targetRate;
    if (ratio === 1) {
      const out = new Int16Array(frame.length);
      for (let i = 0; i < frame.length; i++) out[i] = toInt16(frame[i]);
      return out;
    }
    const outLength = Math.floor((frame.length - this.resampleCursor) / ratio);
    const out = new Int16Array(Math.max(0, outLength));
    let pos = this.resampleCursor;
    for (let i = 0; i < out.length; i++) {
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const a = frame[idx];
      const b = idx + 1 < frame.length ? frame[idx + 1] : a;
      out[i] = toInt16(a + (b - a) * frac);
      pos += ratio;
    }
    this.resampleCursor = pos - frame.length;
    return out;
  }
}

function toInt16(x) {
  const v = x < -1 ? -1 : x > 1 ? 1 : x;
  return v < 0 ? v * 0x8000 : v * 0x7fff;
}

registerProcessor('segmenter', SegmenterProcessor);
