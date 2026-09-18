/**
 * The emails the admin side sends. Inline styles only — mail clients
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

/**
 * Sent once, when a doctor adds someone to their team. The password is the
 * temporary one the server just made — nobody else has seen it, and it is
 * not stored anywhere in the clear, so this mail is the only copy.
 */
export function teamMemberCredentialsEmail(args: {
  name: string;
  doctorName: string;
  email: string;
  password: string;
  loginUrl: string;
}) {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 10px 6px 0;font-size:13px;color:#6b7280;white-space:nowrap">${label}</td>` +
    `<td style="padding:6px 0;font-size:14px;color:#111827;font-family:ui-monospace,Menlo,monospace">${value}</td></tr>`;
  return {
    subject: 'Your myDigitalOPD sign-in details',
    html: shell(
      'Welcome to the team',
      `<p style="font-size:14px;color:#374151;line-height:1.55">Hi ${escapeHtml(args.name)}, ${escapeHtml(args.doctorName)} has added you to their team on myDigitalOPD. Use these details to sign in:</p>
       <table style="border-collapse:collapse;margin:8px 0 16px">
         ${row('Sign in at', `<a href="${escapeHtml(args.loginUrl)}" style="color:#167567">${escapeHtml(args.loginUrl)}</a>`)}
         ${row('Email', escapeHtml(args.email))}
         ${row('Temporary password', escapeHtml(args.password))}
       </table>
       <p style="font-size:13px;color:#374151;line-height:1.55">This password was made for you and no one else knows it. You can choose your own any time with <strong>Forgot password</strong> on the sign-in screen.</p>`,
    ),
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
