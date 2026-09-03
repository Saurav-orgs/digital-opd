import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from './ui';

/** Longest edge of the saved photo. Keeps a prescription legible without
 *  producing a file the 6 MB upload limit would reject. */
const MAX_EDGE = 2400;
const JPEG_QUALITY = 0.92;

export function cameraAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  );
}

/**
 * Photograph a paper prescription without leaving the consultation.
 *
 * Built on `getUserMedia` rather than an `<input capture>`, because that
 * attribute is ignored on desktop — the button would silently open a file
 * dialog on the very machines most clinics use. This works the same on a
 * tablet's rear camera and a desktop webcam, and it adds the step that matters
 * for a document: seeing the shot before keeping it. A blurred or cropped
 * prescription is worse than no photo, and it is only obvious once you look.
 */
export function CameraCapture({
  onCapture,
  onClose,
  busy,
}: {
  onCapture: (file: File) => void;
  onClose: () => void;
  /** The upload is in flight — keep the dialog up but stop further captures. */
  busy?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shot, setShot] = useState<{ url: string; blob: Blob } | null>(null);
  const [starting, setStarting] = useState(true);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;

    navigator.mediaDevices
      // `environment` asks for the rear camera on a tablet and is simply
      // ignored on a laptop, which has only the one.
      .getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {});
        }
        setStarting(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStarting(false);
        const name = (err as { name?: string })?.name;
        setError(
          name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow it in the browser and try again.'
            : name === 'NotFoundError'
              ? 'No camera was found on this device.'
              : 'Could not open the camera on this device.',
        );
      });

    return () => {
      cancelled = true;
      stop();
    };
  }, [stop]);

  // The still is an object URL; it has to be released when it is replaced.
  useEffect(() => {
    return () => {
      if (shot) URL.revokeObjectURL(shot.url);
    };
  }, [shot]);

  const take = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError('Could not capture the photo. Please try again.');
          return;
        }
        setShot({ url: URL.createObjectURL(blob), blob });
        // The preview is a still now, so the camera is no longer needed and
        // holding it keeps the device's light on.
        stop();
      },
      'image/jpeg',
      JPEG_QUALITY,
    );
  };

  const retake = () => {
    setShot(null);
    setStarting(true);
    setError(null);
    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })
      .then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {});
        }
        setStarting(false);
      })
      .catch(() => {
        setStarting(false);
        setError('Could not reopen the camera.');
      });
  };

  const keep = () => {
    if (!shot) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    onCapture(new File([shot.blob], `prescription-${stamp}.jpg`, { type: 'image/jpeg' }));
  };

  const close = () => {
    stop();
    onClose();
  };

  return (
    <Modal
      title="Photograph the prescription"
      onClose={close}
      large
      footer={
        <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontSize: 12.5 }}>
            {shot
              ? 'Check it is readable before keeping it.'
              : 'Fill the frame with the prescription and hold steady.'}
          </span>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-sm" onClick={close} disabled={busy}>
              Cancel
            </button>
            {shot ? (
              <>
                <button className="btn btn-sm" onClick={retake} disabled={busy}>
                  Retake
                </button>
                <button className="btn btn-primary btn-sm" onClick={keep} disabled={busy}>
                  {busy ? 'Uploading…' : 'Use this photo'}
                </button>
              </>
            ) : (
              <button
                className="btn btn-primary btn-sm"
                onClick={take}
                disabled={!!error || starting}
              >
                📷 Capture
              </button>
            )}
          </div>
        </div>
      }
    >
      {error ? (
        <div className="empty">{error}</div>
      ) : (
        <div
          style={{
            background: '#000',
            borderRadius: 8,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 240,
          }}
        >
          {shot ? (
            <img
              src={shot.url}
              alt="Captured prescription"
              style={{ width: '100%', maxHeight: '60vh', objectFit: 'contain', display: 'block' }}
            />
          ) : (
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              style={{ width: '100%', maxHeight: '60vh', objectFit: 'contain', display: 'block' }}
            />
          )}
        </div>
      )}
      {starting && !error && (
        <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
          Opening the camera…
        </div>
      )}
    </Modal>
  );
}
