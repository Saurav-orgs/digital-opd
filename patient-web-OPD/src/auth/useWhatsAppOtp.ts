import { useCallback, useEffect, useRef, useState } from 'react';
import { patientApi } from '../patientApi';
import { ApiException } from '../types';

/**
 * The WhatsApp code a new number must type before it can open an account.
 *
 * Held in a hook rather than a component because the two places it appears
 * own their own submit buttons — the booking form's footer "Continue" and the
 * register page's button — and both need to call `verify` from there. The
 * `OtpCodeField` component renders the input; this owns the state.
 */
export function useWhatsAppOtp(mobile: string) {
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const startCountdown = (seconds: number) => {
    if (timer.current) window.clearInterval(timer.current);
    setResendIn(seconds);
    timer.current = window.setInterval(() => {
      setResendIn((s) => {
        if (s <= 1) {
          if (timer.current) window.clearInterval(timer.current);
          timer.current = null;
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  };
  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); }, []);

  const fail = (err: unknown, fallback: string) =>
    setError(err instanceof ApiException ? err.message : fallback);

  /** Send (or resend) a code. Resolves true when a message went out. */
  const send = useCallback(async (): Promise<boolean> => {
    setSending(true);
    setError(null);
    try {
      const res = await patientApi.sendOtp(mobile);
      setSent(true);
      setCode('');
      startCountdown(res.resendAfter);
      return true;
    } catch (err) {
      fail(err, 'Could not send the WhatsApp code. Please try again.');
      // A cooldown refusal still means a code is on its way — let them type it.
      if (err instanceof ApiException && err.code === 'RATE_LIMITED') setSent(true);
      return false;
    } finally {
      setSending(false);
    }
  }, [mobile]);

  /** Check the typed code. Resolves true once the number is verified. */
  const verify = useCallback(async (): Promise<boolean> => {
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from WhatsApp.');
      return false;
    }
    setVerifying(true);
    setError(null);
    try {
      await patientApi.verifyOtp(mobile, code);
      return true;
    } catch (err) {
      fail(err, 'Could not verify the code. Please try again.');
      return false;
    } finally {
      setVerifying(false);
    }
  }, [mobile, code]);

  const reset = useCallback(() => {
    setCode('');
    setSent(false);
    setError(null);
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    setResendIn(0);
  }, []);

  return {
    code,
    setCode: (v: string) => {
      setCode(v.replace(/\D/g, '').slice(0, 6));
      setError(null);
    },
    sent,
    sending,
    verifying,
    resendIn,
    error,
    send,
    verify,
    reset,
  };
}

export type WhatsAppOtp = ReturnType<typeof useWhatsAppOtp>;
