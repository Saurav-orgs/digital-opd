import React from 'react';
import { MessageCircle } from 'lucide-react';
import type { WhatsAppOtp } from '../auth/useWhatsAppOtp';

/**
 * The six-digit WhatsApp code box, with the "sent to" line above it and
 * "Resend" below. The verify button is deliberately not here — each page
 * that shows this already has a submit button, and that button verifies.
 */
export const OtpCodeField: React.FC<{
  mobile: string;
  otp: WhatsAppOtp;
  autoFocus?: boolean;
}> = ({ mobile, otp, autoFocus }) => (
  <>
    <p
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        fontSize: 13,
        color: 'var(--text-secondary)',
        marginTop: -4,
      }}
    >
      <MessageCircle size={16} color="#25D366" style={{ flexShrink: 0, marginTop: 1 }} />
      <span>
        {otp.sent
          ? <>We sent a 6-digit code on <strong>WhatsApp</strong> to +91 {mobile}. It is valid for 10 minutes.</>
          : otp.sending
            ? <>Sending a code on <strong>WhatsApp</strong> to +91 {mobile}…</>
            : <>We could not send the code to +91 {mobile}.</>}
      </span>
    </p>
    <div className="form-field">
      <label className="form-label">Verification code *</label>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        className={'form-input' + (otp.error ? ' error' : '')}
        placeholder="6-digit code"
        maxLength={6}
        value={otp.code}
        onChange={(e) => otp.setCode(e.target.value)}
        style={{ letterSpacing: '0.3em', fontSize: 18, fontWeight: 600 }}
      />
      {otp.error && <span className="error-text">{otp.error}</span>}
    </div>
    <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
      {otp.resendIn > 0 ? (
        <>Didn’t get it? Resend in {otp.resendIn}s</>
      ) : (
        <>
          Didn’t get it?{' '}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              if (!otp.sending) void otp.send();
            }}
          >
            {otp.sent ? 'Resend code' : 'Send again'}
          </a>
        </>
      )}
    </div>
  </>
);
