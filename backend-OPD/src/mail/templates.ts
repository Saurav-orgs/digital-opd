/**
 * The two emails the admin side sends. Inline styles only — mail clients
 * strip stylesheets — and nothing clever: a code to type, a button to press.
 */

const shell = (title: string, body: string) => `
<div style="font-family:Inter,-apple-system,Segoe UI,sans-serif;background:#f4f6f5;padding:28px 12px">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:28px 26px;border:1px solid #e3e8e6">
    <div style="font-size:13px;font-weight:700;letter-spacing:.04em;color:#167567;margin-bottom:14px">myDigitalOPD</div>
    <h1 style="font-size:20px;margin:0 0 12px;color:#111827">${title}</h1>
    ${body}
    <p style="font-size:12px;color:#6b7280;margin:24px 0 0">If you did not ask for this, you can ignore this email.</p>
  </div>
</div>`;

export function verificationCodeEmail(code: string, minutes: number) {
  return {
    subject: `${code} is your myDigitalOPD verification code`,
    html: shell(
      'Verify your email',
      `<p style="font-size:14px;color:#374151;line-height:1.55">Enter this code to continue setting up your practice. It expires in ${minutes} minutes.</p>
       <div style="font-size:32px;font-weight:700;letter-spacing:.35em;text-align:center;padding:16px 0 6px;color:#0d4f45">${code}</div>`,
    ),
  };
}

export function passwordResetCodeEmail(name: string, code: string, minutes: number) {
  return {
    subject: `${code} is your myDigitalOPD password reset code`,
    html: shell(
      'Reset your password',
      `<p style="font-size:14px;color:#374151;line-height:1.55">Hi ${escapeHtml(name)}, enter this code on the Forgot password screen to choose a new password. It expires in ${minutes} minutes.</p>
       <div style="font-size:32px;font-weight:700;letter-spacing:.35em;text-align:center;padding:16px 0 6px;color:#0d4f45">${code}</div>`,
    ),
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
