/**
 * email-templates.ts — transactional emails that are NOT sign-in links.
 *
 * Kept separate from the magic-link template on purpose: an email that asks the
 * reader to confirm a change must never look like (or reuse the wording of) a
 * "Sign in to Hisaabo" email, because a victim who is tricked into clicking a
 * sign-in-looking link for someone else's request is the attack. Pure functions
 * returning `{ subject, html, text }` so they can be unit-tested without sending.
 *
 * Every dynamic value passes through escapeHtml; nothing user-controlled other
 * than an email address or an organisation name is interpolated, and display
 * names of users are never used.
 */

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

interface CardOptions {
  subject: string;
  preheader: string;
  heading: string;
  /** Already-escaped HTML paragraphs. */
  bodyHtml: string[];
  cta?: { label: string; url: string };
  /** Plain text shown in the grey notice box at the bottom. */
  footnote: string;
}

function renderCard(o: CardOptions): string {
  const paragraphs = o.bodyHtml
    .map(
      (p) =>
        `<p style="margin: 0 0 16px 0; font-family: ${FONT}; font-size: 15px; line-height: 24px; color: #4b5563;">${p}</p>`,
    )
    .join("\n");
  const cta = o.cta
    ? `<tr><td style="padding: 8px 40px 0 40px;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
<tr><td style="text-align: center; padding: 4px 0 20px 0;">
<a href="${escapeHtml(o.cta.url)}" target="_blank" style="display: inline-block; width: 100%; max-width: 320px; padding: 14px 32px; background: #4f46e5; color: #ffffff; font-family: ${FONT}; font-size: 16px; font-weight: 600; text-decoration: none; text-align: center; border-radius: 10px; box-sizing: border-box;">${escapeHtml(o.cta.label)}</a>
</td></tr>
</table>
</td></tr>
<tr><td style="padding: 8px 40px 0 40px;">
<p style="margin: 0 0 6px 0; font-family: ${FONT}; font-size: 12px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.5px;">Button not working? Copy this link:</p>
<p style="margin: 0; font-family: ${FONT}; font-size: 12px; line-height: 18px; color: #6b7280; word-break: break-all;">${escapeHtml(o.cta.url)}</p>
</td></tr>`
    : "";
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(o.subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6;">
<div style="display: none; max-height: 0; overflow: hidden; font-size: 1px; line-height: 1px; color: #f3f4f6;">${escapeHtml(o.preheader)}</div>
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f3f4f6;">
<tr><td style="padding: 40px 16px;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 480px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb;">
<tr><td style="height: 4px; background: #4f46e5; font-size: 0; line-height: 0;">&nbsp;</td></tr>
<tr><td style="padding: 28px 40px 0 40px; text-align: center; font-family: ${FONT}; font-size: 22px; font-weight: 700; color: #111827;">Hisaabo</td></tr>
<tr><td style="padding: 24px 40px 0 40px;">
<h1 style="margin: 0 0 16px 0; font-family: ${FONT}; font-size: 22px; font-weight: 700; color: #111827; text-align: center; line-height: 28px;">${escapeHtml(o.heading)}</h1>
${paragraphs}
</td></tr>
${cta}
<tr><td style="padding: 20px 40px 32px 40px;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f9fafb; border-radius: 8px;">
<tr><td style="padding: 12px 16px;">
<p style="margin: 0; font-family: ${FONT}; font-size: 12px; line-height: 18px; color: #9ca3af;">${escapeHtml(o.footnote)}</p>
</td></tr>
</table>
</td></tr>
</table>
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 480px; margin: 0 auto;">
<tr><td style="padding: 24px 40px 0 40px; text-align: center;">
<p style="margin: 0; font-family: ${FONT}; font-size: 12px; line-height: 18px; color: #9ca3af;">Hisaabo &mdash; free, open-source invoicing for Indian businesses</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/**
 * Sent to the NEW address of an email change. The button confirms the change
 * only for the account that asked for it, while signed in to that account — it
 * is deliberately worded and styled unlike a sign-in email. Only the (escaped)
 * current email of the requesting account is interpolated, never its name.
 */
export function renderEmailChangeConfirmation(confirmUrl: string, currentEmail: string): RenderedEmail {
  const subject = "Confirm your new Hisaabo email address";
  const current = escapeHtml(currentEmail);
  const html = renderCard({
    subject,
    preheader: "Confirm this address for your Hisaabo account.",
    heading: "Confirm your new email address",
    bodyHtml: [
      `The Hisaabo account <strong>${current}</strong> asked to use this address as its sign-in email.`,
      "If that was you, confirm below while signed in to that account.",
      "If you didn't ask for this, ignore this email. Nothing will change and no account will be created.",
    ],
    cta: { label: "Confirm email change", url: confirmUrl },
    footnote: "This link works once and expires in 15 minutes.",
  });
  const text =
    `${subject}\n\nThe Hisaabo account ${currentEmail} asked to use this address as its sign-in email. ` +
    "If that was you, confirm below while signed in to that account. " +
    "If you didn't ask for this, ignore this email. Nothing will change and no account will be created.\n\n" +
    `Confirm email change: ${confirmUrl}\n`;
  return { subject, html, text };
}

/** Sent to the OLD address after a verified account's email was changed. */
export function renderEmailChangedNotice(oldEmail: string, newEmail: string): RenderedEmail {
  const subject = "Your Hisaabo sign-in email was changed";
  const html = renderCard({
    subject,
    preheader: "The sign-in email of your Hisaabo account was changed.",
    heading: "Your sign-in email was changed",
    bodyHtml: [
      `Your Hisaabo sign-in email was changed to <strong>${escapeHtml(newEmail)}</strong>.`,
      "If this wasn't you, contact support.",
    ],
    footnote: `This notice was sent to ${oldEmail} because it was the previous sign-in email.`,
  });
  const text = `${subject}\n\nYour Hisaabo sign-in email was changed to ${newEmail}. If this wasn't you, contact support.\n`;
  return { subject, html, text };
}

export interface SecurityNoticeMember {
  email: string;
  role: string;
}
export interface SecurityNoticeOrg {
  orgName: string;
  members: SecurityNoticeMember[];
}

/**
 * Sent after an account's email was proven for the first time (the account may
 * have been pre-registered by someone else): lists who already had access.
 */
export function renderSecurityNotice(orgs: SecurityNoticeOrg[]): RenderedEmail {
  const subject = "Review who has access to your Hisaabo organization";
  const blocks = orgs.map((o) => {
    const items = o.members
      .map((m) => `<li>${escapeHtml(m.email)} &mdash; ${escapeHtml(m.role)}</li>`)
      .join("");
    return `These people were given access to <strong>${escapeHtml(o.orgName)}</strong> before that: <ul style="margin: 8px 0 0 0; padding-left: 20px;">${items}</ul>`;
  });
  const html = renderCard({
    subject,
    preheader: "Check who has access to your Hisaabo organization.",
    heading: "Review who has access",
    bodyHtml: [
      "You confirmed this email address for the first time.",
      ...blocks,
      "If you don't recognise someone, remove them in Settings &rarr; Team. Also review your bank and UPI details, payment gateway and e-invoice settings in Settings.",
    ],
    footnote: "You are receiving this because your account existed before this email address was confirmed.",
  });
  const text =
    `${subject}\n\nYou confirmed this email address for the first time.\n` +
    orgs
      .map((o) => `\nThese people were given access to ${o.orgName} before that:\n` + o.members.map((m) => `  - ${m.email} - ${m.role}`).join("\n"))
      .join("\n") +
    "\n\nIf you don't recognise someone, remove them in Settings -> Team. Also review your bank and UPI details, payment gateway and e-invoice settings in Settings.\n";
  return { subject, html, text };
}
