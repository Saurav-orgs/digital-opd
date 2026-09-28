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

/**
 * Sent once the subscription payment has gone through — the doctor is
 * probably still on the "payment received" page, but the mail is the copy
 * that survives the tab.
 */
export function paymentReceivedEmail(args: {
  planName: string;
  total: number;
  endsAt: Date;
  loginUrl: string;
  email: string;
  /** Printed only when an invoice was raised and attached. */
  invoiceNo?: string | null;
}) {
  const until = args.endsAt.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const amount = '₹' + args.total.toLocaleString('en-IN', { minimumFractionDigits: 2 });
  return {
    subject: `Payment received — your myDigitalOPD ${args.planName} plan is active`,
    html: shell(
      'Welcome to myDigitalOPD',
      `<p style="font-size:14px;color:#374151;line-height:1.55">We received ${amount} (incl. GST) for the <strong>${escapeHtml(args.planName)}</strong> plan. Your subscription runs until <strong>${until}</strong>.</p>
       <p style="font-size:14px;color:#374151;line-height:1.55">Sign in with <strong>${escapeHtml(args.email)}</strong> and the password you chose at sign-up. On your first sign-in we will ask for your practice details, and your booking page goes live right after.</p>
       <p style="margin:20px 0 6px"><a href="${escapeHtml(args.loginUrl)}" style="display:inline-block;background:#167567;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">Sign in to myDigitalOPD</a></p>
       ${args.invoiceNo ? `<p style="font-size:13px;color:#374151;line-height:1.55;margin-top:18px">Your invoice <strong>${escapeHtml(args.invoiceNo)}</strong> is attached to this email. You can download it again any time from <strong>Billing</strong> inside your account.</p>` : ''}
       <p style="font-size:13px;color:#6b7280;line-height:1.55">Forgotten your password? Use <strong>Forgot password</strong> on the sign-in screen.</p>`,
    ),
  };
}

/**
 * Sent when a super admin gives an account a plan rather than it being paid
 * for online — a trial, a complimentary stretch, or money taken offline. It
 * says plainly that nothing was charged, so nobody goes looking for a receipt.
 */
export function planGrantedEmail(args: {
  planName: string;
  months: number;
  endsAt: Date;
  note: string | null;
  loginUrl: string;
}) {
  const until = args.endsAt.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return {
    subject: `Your myDigitalOPD ${args.planName} plan is active`,
    html: shell(
      'Your plan is active',
      `<p style="font-size:14px;color:#374151;line-height:1.55">${args.months} month(s) of the <strong>${escapeHtml(args.planName)}</strong> plan have been added to your account. It runs until <strong>${until}</strong>. No payment was taken for this.</p>
       ${args.note ? `<p style="font-size:14px;color:#374151;line-height:1.55">${escapeHtml(args.note)}</p>` : ''}
       <p style="margin:20px 0 6px"><a href="${escapeHtml(args.loginUrl)}" style="display:inline-block;background:#167567;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">Sign in to myDigitalOPD</a></p>`,
    ),
  };
}

/**
 * A doctor the super admin opened an account for. Unlike the paid sign-up,
 * nobody chose a password here, so this mail carries the one we made —
 * which is why it also says, plainly, to replace it.
 *
 * Whether a plan was mapped at the same time changes what the doctor can do
 * next, so the mail says which: with a plan they can sign in now, without one
 * they would only meet a locked door, and being told that here saves the call.
 */
export function doctorInviteEmail(args: {
  name: string;
  email: string;
  password: string;
  loginUrl: string;
  plan: { name: string; endsAt: Date } | null;
}) {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 10px 6px 0;font-size:13px;color:#6b7280;white-space:nowrap">${label}</td>` +
    `<td style="padding:6px 0;font-size:14px;color:#111827;font-family:ui-monospace,Menlo,monospace">${value}</td></tr>`;
  const until = args.plan
    ? args.plan.endsAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  return {
    subject: 'Your myDigitalOPD account is ready',
    html: shell(
      'Welcome to myDigitalOPD',
      `<p style="font-size:14px;color:#374151;line-height:1.55">Hi ${escapeHtml(args.name)}, an account has been created for you on myDigitalOPD. Use these details to sign in:</p>
       <table style="border-collapse:collapse;margin:8px 0 16px">
         ${row('Sign in at', `<a href="${escapeHtml(args.loginUrl)}" style="color:#167567">${escapeHtml(args.loginUrl)}</a>`)}
         ${row('Email', escapeHtml(args.email))}
         ${row('Temporary password', escapeHtml(args.password))}
       </table>
       ${
         args.plan
           ? `<p style="font-size:14px;color:#374151;line-height:1.55">Your <strong>${escapeHtml(args.plan.name)}</strong> plan is active until <strong>${until}</strong>. On your first sign-in we will ask for your practice details, and your booking page goes live right after.</p>`
           : `<p style="font-size:14px;color:#374151;line-height:1.55">A plan has not been added to your account yet, so sign-in will be held until one is. We will email you as soon as it is ready.</p>`
       }
       <p style="margin:20px 0 6px"><a href="${escapeHtml(args.loginUrl)}" style="display:inline-block;background:#167567;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">Sign in to myDigitalOPD</a></p>
       <p style="font-size:13px;color:#374151;line-height:1.55">This password was made for you and is meant to be replaced: the first screen after you sign in asks you to choose your own.</p>`,
    ),
  };
}
