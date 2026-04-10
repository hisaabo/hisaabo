// ── Email service abstraction ──────────────────────────────────
// Dev: prints magic link to console (no setup needed)
// Prod: sends via Resend API (no npm dep — raw fetch)

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

interface EmailService {
  sendMagicLink(to: string, magicLinkUrl: string, deepLinkUrl?: string, isNewUser?: boolean): Promise<void>;
  sendInvitation(to: string, inviteUrl: string, businessName: string, inviterName: string | null): Promise<void>;
}

class ConsoleEmailService implements EmailService {
  async sendMagicLink(to: string, magicLinkUrl: string, deepLinkUrl?: string, isNewUser?: boolean): Promise<void> {
    if (process.env.NODE_ENV === "production") {
      console.error("[email] FATAL: No email service configured for production. Set RESEND_API_KEY.");
      throw new Error("Email service not configured");
    }
    console.log("");
    console.log("╔══════════════════════════════════════════════════════════╗");
    console.log(`║  ${isNewUser ? "WELCOME" : "Magic link"} for ${to.padEnd(isNewUser ? 36 : 40)}║`);
    console.log("╠══════════════════════════════════════════════════════════╣");
    console.log(`║  Primary:   ${magicLinkUrl}`);
    if (deepLinkUrl) console.log(`║  Secondary: ${deepLinkUrl}`);
    console.log("╚══════════════════════════════════════════════════════════╝");
    console.log("");
  }

  async sendInvitation(to: string, inviteUrl: string, businessName: string, inviterName: string | null): Promise<void> {
    if (process.env.NODE_ENV === "production") {
      console.error("[email] FATAL: No email service configured for production. Set RESEND_API_KEY.");
      throw new Error("Email service not configured");
    }
    console.log("");
    console.log("╔══════════════════════════════════════════════════════════╗");
    console.log(`║  Invitation for ${to.padEnd(40)}║`);
    console.log(`║  From: ${(inviterName ?? "Someone").padEnd(49)}║`);
    console.log(`║  Business: ${businessName.padEnd(47)}║`);
    console.log("╠══════════════════════════════════════════════════════════╣");
    console.log(`║  ${inviteUrl}`);
    console.log("╚══════════════════════════════════════════════════════════╝");
    console.log("");
  }
}

class ResendEmailService implements EmailService {
  constructor(
    private apiKey: string,
    private fromAddress: string,
  ) {}

  async sendMagicLink(to: string, magicLinkUrl: string, deepLinkUrl?: string, isNewUser?: boolean): Promise<void> {
    // Secondary link: when primary is the web URL, secondary is the deep link
    // (for desktop/mobile users). When primary is the deep link, secondary is the web URL.
    const isSecondaryWeb = deepLinkUrl?.startsWith("http");
    const secondaryLabel = isSecondaryWeb ? "Open in browser instead" : "Using the desktop app? Open in Hisaabo";
    const deepLinkHtml = deepLinkUrl
      ? `<tr><td style="padding: 0 40px;"><table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%"><tr><td style="padding: 4px 0 0 0; text-align: center;"><p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 13px; line-height: 20px; color: #6b7280;"><a href="${escapeHtml(deepLinkUrl)}" style="color: #4f46e5; text-decoration: underline; font-weight: 500;">${secondaryLabel}</a></p></td></tr></table></td></tr>`
      : "";

    const subject = isNewUser ? "Welcome to Hisaabo" : "Sign in to Hisaabo";
    const preheader = isNewUser
      ? "Your business deserves pakka hisaab. Set up your account and start invoicing in under 2 minutes."
      : "Sign in to your Hisaabo account. This link expires in 15 minutes.";

    // Welcome email: feature highlights + onboarding CTA
    // Returning user: simple sign-in CTA
    const mainContentHtml = isNewUser
      ? `<!-- Main content — welcome variant -->
<tr><td style="padding: 28px 40px 0 40px;">
<h1 style="margin: 0 0 12px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 22px; font-weight: 700; color: #111827; text-align: center; line-height: 28px;">Your business deserves pakka hisaab.</h1>
<p style="margin: 0 0 20px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 15px; line-height: 24px; color: #4b5563; text-align: center;">Welcome to Hisaabo. You're one click away from professional invoicing that just works. Tap the button below to set up your business profile and send your first invoice today.</p>
</td></tr>

<!-- Feature highlights -->
<tr><td style="padding: 0 40px 20px 40px;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f9fafb; border-radius: 10px;">
<tr><td style="padding: 16px 20px;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
<tr><td style="padding: 4px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 14px; line-height: 22px; color: #374151;">&#10003;&ensp;GST-compliant invoices in seconds</td></tr>
<tr><td style="padding: 4px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 14px; line-height: 22px; color: #374151;">&#10003;&ensp;Party ledgers with &#8377; balance tracking</td></tr>
<tr><td style="padding: 4px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 14px; line-height: 22px; color: #374151;">&#10003;&ensp;Record payments, track what's due</td></tr>
<tr><td style="padding: 4px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 14px; line-height: 22px; color: #374151;">&#10003;&ensp;Business reports at a glance</td></tr>
</table>
</td></tr>
</table>
</td></tr>`
      : `<!-- Main content — sign-in variant -->
<tr><td style="padding: 28px 40px 0 40px;">
<h1 style="margin: 0 0 12px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 22px; font-weight: 700; color: #111827; text-align: center; line-height: 28px;">Sign in to your account</h1>
<p style="margin: 0 0 24px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 15px; line-height: 24px; color: #4b5563; text-align: center;">Tap the button below to securely sign in. This link is single-use and expires in <strong style="color: #374151;">15 minutes</strong>.</p>
</td></tr>`;

    const ctaLabel = isNewUser ? "Start My Setup" : "Sign in to Hisaabo";
    const ctaLabelOutlook = isNewUser ? "Start My Setup" : "Sign in to Hisaabo";

    // Reassurance line for new users only
    const reassuranceHtml = isNewUser
      ? `<tr><td style="padding: 12px 40px 0 40px; text-align: center;"><p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 13px; color: #6b7280;">Setup takes under 2 minutes. No payment required &mdash; Hisaabo is free.</p></td></tr>`
      : "";

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.fromAddress,
        to,
        subject,
        html: `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>${subject}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;">

<!-- Preheader text (hidden, shows in inbox preview) -->
<div style="display: none; max-height: 0; overflow: hidden; font-size: 1px; line-height: 1px; color: #f3f4f6;">${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>

<!-- Outer wrapper table for background -->
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f3f4f6;">
<tr><td style="padding: 40px 16px;">

<!-- Inner card container -->
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 480px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb;">

<!-- Brand accent stripe -->
<tr><td style="height: 4px; background: linear-gradient(90deg, #4f46e5 0%, #6366f1 50%, #4f46e5 100%); font-size: 0; line-height: 0;">&nbsp;</td></tr>

<!-- Logo + brand mark -->
<!-- Grid lockup is built from nested tables (not an image) so it renders identically in Gmail, Outlook, Apple Mail — no image-blocking, no external fetch, no broken alt. Matches favicon.svg: indigo rounded square with 4 inner squares, bottom-right in gold. Inner square colors are pre-blended (96%/58% white on #5b5bd6, plus amber) because some clients flatten layered opacity inconsistently. -->
<tr><td style="padding: 32px 40px 0 40px; text-align: center;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="margin: 0 auto;">
<tr>
<td style="vertical-align: middle; line-height: 1; font-size: 0;">
<table role="presentation" border="0" cellpadding="0" cellspacing="4" bgcolor="#5b5bd6" style="background-color: #5b5bd6; border-radius: 8px; border-collapse: separate;">
<tr>
<td width="12" height="12" bgcolor="#F8F8FF" style="background-color: #F8F8FF; border-radius: 2px; font-size: 1px; line-height: 1px; mso-line-height-rule: exactly;">&nbsp;</td>
<td width="12" height="12" bgcolor="#BDBDEE" style="background-color: #BDBDEE; border-radius: 2px; font-size: 1px; line-height: 1px; mso-line-height-rule: exactly;">&nbsp;</td>
</tr>
<tr>
<td width="12" height="12" bgcolor="#BDBDEE" style="background-color: #BDBDEE; border-radius: 2px; font-size: 1px; line-height: 1px; mso-line-height-rule: exactly;">&nbsp;</td>
<td width="12" height="12" bgcolor="#fbbf24" style="background-color: #fbbf24; border-radius: 2px; font-size: 1px; line-height: 1px; mso-line-height-rule: exactly;">&nbsp;</td>
</tr>
</table>
</td>
<td height="36" style="padding-left: 12px; vertical-align: middle; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 22px; font-weight: 700; color: #111827; letter-spacing: -0.3px; line-height: 36px;">Hisaabo</td>
</tr>
</table>
</td></tr>

${mainContentHtml}

<!-- CTA Button -->
<tr><td style="padding: 0 40px;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
<tr><td style="text-align: center; padding: 4px 0 20px 0;">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeHtml(magicLinkUrl)}" style="height:52px;v-text-anchor:middle;width:320px;" arcsize="15%" fill="t"><v:fill type="gradient" color="#4f46e5" color2="#4338ca" angle="180" /><w:anchorlock/><center style="color:#ffffff;font-family:sans-serif;font-size:16px;font-weight:bold;">${ctaLabelOutlook}</center></v:roundrect><![endif]-->
<!--[if !mso]><!-->
<a href="${escapeHtml(magicLinkUrl)}" target="_blank" style="display: inline-block; width: 100%; max-width: 320px; padding: 14px 32px; background: linear-gradient(180deg, #4f46e5 0%, #4338ca 100%); color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 16px; font-weight: 600; text-decoration: none; text-align: center; border-radius: 10px; box-sizing: border-box; -webkit-text-size-adjust: none; mso-hide: all;">${ctaLabel}</a>
<!--<![endif]-->
</td></tr>
</table>
</td></tr>

${reassuranceHtml}

<!-- Deep link (optional) -->
${deepLinkHtml}

<!-- Divider -->
<tr><td style="padding: 24px 40px 0 40px;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
<tr><td style="border-top: 1px solid #e5e7eb; font-size: 0; line-height: 0; height: 1px;">&nbsp;</td></tr>
</table>
</td></tr>

<!-- Fallback URL -->
<tr><td style="padding: 20px 40px 0 40px;">
<p style="margin: 0 0 6px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 12px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.5px;">Button not working? Copy this link:</p>
<p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 12px; line-height: 18px; color: #6b7280; word-break: break-all;">${escapeHtml(magicLinkUrl)}</p>
</td></tr>

<!-- Safety notice -->
<tr><td style="padding: 20px 40px 32px 40px;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f9fafb; border-radius: 8px;">
<tr><td style="padding: 12px 16px;">
<p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 12px; line-height: 18px; color: #9ca3af;">If you didn't request this email, you can safely ignore it. No account changes have been made.</p>
</td></tr>
</table>
</td></tr>

</table>
<!-- End inner card -->

<!-- Footer -->
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 480px; margin: 0 auto;">
<tr><td style="padding: 24px 40px 0 40px; text-align: center;">
<p style="margin: 0 0 4px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 13px; font-weight: 600; color: #6b7280;">Hisaabo &mdash; <span style="color: #4f46e5;">Hisaab, pakka.</span></p>
<p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 12px; line-height: 18px; color: #9ca3af;">Free, open-source invoicing for Indian businesses</p>
</td></tr>
</table>

</td></tr>
</table>
<!-- End outer wrapper -->

</body>
</html>`,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[email] Resend API error: ${res.status} ${text}`);
      throw new Error("Failed to send email");
    }
  }

  async sendInvitation(to: string, inviteUrl: string, businessName: string, inviterName: string | null): Promise<void> {
    const fromDisplay = escapeHtml(inviterName ?? "Someone");
    const bizDisplay = escapeHtml(businessName);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.fromAddress,
        to,
        subject: `You've been invited to join ${businessName} on Hisaabo`,
        html: `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>You've been invited to join ${bizDisplay} on Hisaabo</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;">

<!-- Preheader text (hidden, shows in inbox preview) -->
<div style="display: none; max-height: 0; overflow: hidden; font-size: 1px; line-height: 1px; color: #f3f4f6;">${fromDisplay} invited you to join ${bizDisplay} on Hisaabo. Accept your invitation to get started.&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>

<!-- Outer wrapper table for background -->
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f3f4f6;">
<tr><td style="padding: 40px 16px;">

<!-- Inner card container -->
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 480px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb;">

<!-- Brand accent stripe -->
<tr><td style="height: 4px; background: linear-gradient(90deg, #4f46e5 0%, #6366f1 50%, #4f46e5 100%); font-size: 0; line-height: 0;">&nbsp;</td></tr>

<!-- Logo + brand mark -->
<!-- Grid lockup is built from nested tables (not an image) so it renders identically in Gmail, Outlook, Apple Mail — no image-blocking, no external fetch, no broken alt. Matches favicon.svg: indigo rounded square with 4 inner squares, bottom-right in gold. Inner square colors are pre-blended (96%/58% white on #5b5bd6, plus amber) because some clients flatten layered opacity inconsistently. -->
<tr><td style="padding: 32px 40px 0 40px; text-align: center;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="margin: 0 auto;">
<tr>
<td style="vertical-align: middle; line-height: 1; font-size: 0;">
<table role="presentation" border="0" cellpadding="0" cellspacing="4" bgcolor="#5b5bd6" style="background-color: #5b5bd6; border-radius: 8px; border-collapse: separate;">
<tr>
<td width="12" height="12" bgcolor="#F8F8FF" style="background-color: #F8F8FF; border-radius: 2px; font-size: 1px; line-height: 1px; mso-line-height-rule: exactly;">&nbsp;</td>
<td width="12" height="12" bgcolor="#BDBDEE" style="background-color: #BDBDEE; border-radius: 2px; font-size: 1px; line-height: 1px; mso-line-height-rule: exactly;">&nbsp;</td>
</tr>
<tr>
<td width="12" height="12" bgcolor="#BDBDEE" style="background-color: #BDBDEE; border-radius: 2px; font-size: 1px; line-height: 1px; mso-line-height-rule: exactly;">&nbsp;</td>
<td width="12" height="12" bgcolor="#fbbf24" style="background-color: #fbbf24; border-radius: 2px; font-size: 1px; line-height: 1px; mso-line-height-rule: exactly;">&nbsp;</td>
</tr>
</table>
</td>
<td height="36" style="padding-left: 12px; vertical-align: middle; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 22px; font-weight: 700; color: #111827; letter-spacing: -0.3px; line-height: 36px;">Hisaabo</td>
</tr>
</table>
</td></tr>

<!-- Invitation badge -->
<tr><td style="padding: 24px 40px 0 40px; text-align: center;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
<tr><td style="padding: 6px 14px; background-color: #eef2ff; border-radius: 20px;">
<p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 12px; font-weight: 600; color: #4f46e5; text-transform: uppercase; letter-spacing: 0.5px;">Team Invitation</p>
</td></tr>
</table>
</td></tr>

<!-- Main content -->
<tr><td style="padding: 20px 40px 0 40px;">
<h1 style="margin: 0 0 16px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 22px; font-weight: 700; color: #111827; text-align: center; line-height: 28px;">You've been invited to join a team</h1>
</td></tr>

<!-- Invitation details card -->
<tr><td style="padding: 0 40px;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f9fafb; border-radius: 10px; border: 1px solid #e5e7eb;">
<tr><td style="padding: 20px 24px;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
<!-- Business name row -->
<tr>
<td style="padding: 0 0 12px 0; width: 80px; vertical-align: top;"><p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 12px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.3px;">Business</p></td>
<td style="padding: 0 0 12px 0; vertical-align: top;"><p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 15px; font-weight: 600; color: #111827;">${bizDisplay}</p></td>
</tr>
<!-- Invited by row -->
<tr>
<td style="padding: 0; width: 80px; vertical-align: top;"><p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 12px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.3px;">From</p></td>
<td style="padding: 0; vertical-align: top;"><p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 15px; color: #374151;">${fromDisplay}</p></td>
</tr>
</table>
</td></tr>
</table>
</td></tr>

<!-- Context message -->
<tr><td style="padding: 20px 40px 0 40px;">
<p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 14px; line-height: 22px; color: #6b7280; text-align: center;">Accept the invitation below to start collaborating on <strong style="color: #374151;">${bizDisplay}</strong>'s invoices, parties, and reports.</p>
</td></tr>

<!-- CTA Button -->
<tr><td style="padding: 24px 40px 0 40px;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
<tr><td style="text-align: center; padding: 0 0 4px 0;">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeHtml(inviteUrl)}" style="height:52px;v-text-anchor:middle;width:320px;" arcsize="15%" fill="t"><v:fill type="gradient" color="#4f46e5" color2="#4338ca" angle="180" /><w:anchorlock/><center style="color:#ffffff;font-family:sans-serif;font-size:16px;font-weight:bold;">Accept Invitation</center></v:roundrect><![endif]-->
<!--[if !mso]><!-->
<a href="${escapeHtml(inviteUrl)}" target="_blank" style="display: inline-block; width: 100%; max-width: 320px; padding: 14px 32px; background: linear-gradient(180deg, #4f46e5 0%, #4338ca 100%); color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 16px; font-weight: 600; text-decoration: none; text-align: center; border-radius: 10px; box-sizing: border-box; -webkit-text-size-adjust: none; mso-hide: all;">Accept Invitation</a>
<!--<![endif]-->
</td></tr>
</table>
</td></tr>

<!-- Expiry notice -->
<tr><td style="padding: 16px 40px 0 40px; text-align: center;">
<p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 12px; color: #9ca3af;">This invitation expires in <strong style="color: #6b7280;">7 days</strong></p>
</td></tr>

<!-- Divider -->
<tr><td style="padding: 24px 40px 0 40px;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
<tr><td style="border-top: 1px solid #e5e7eb; font-size: 0; line-height: 0; height: 1px;">&nbsp;</td></tr>
</table>
</td></tr>

<!-- Fallback URL -->
<tr><td style="padding: 20px 40px 0 40px;">
<p style="margin: 0 0 6px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 12px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.5px;">Button not working? Copy this link:</p>
<p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 12px; line-height: 18px; color: #6b7280; word-break: break-all;">${escapeHtml(inviteUrl)}</p>
</td></tr>

<!-- Safety notice -->
<tr><td style="padding: 20px 40px 32px 40px;">
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f9fafb; border-radius: 8px;">
<tr><td style="padding: 12px 16px;">
<p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 12px; line-height: 18px; color: #9ca3af;">If you weren't expecting this invitation, you can safely ignore this email. No account will be created unless you accept.</p>
</td></tr>
</table>
</td></tr>

</table>
<!-- End inner card -->

<!-- Footer -->
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 480px; margin: 0 auto;">
<tr><td style="padding: 24px 40px 0 40px; text-align: center;">
<p style="margin: 0 0 4px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 13px; font-weight: 600; color: #6b7280;">Hisaabo &mdash; <span style="color: #4f46e5;">Hisaab, pakka.</span></p>
<p style="margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 12px; line-height: 18px; color: #9ca3af;">Free, open-source invoicing for Indian businesses</p>
</td></tr>
</table>

</td></tr>
</table>
<!-- End outer wrapper -->

</body>
</html>`,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[email] Resend API error: ${res.status} ${text}`);
      throw new Error("Failed to send email");
    }
  }
}

function createEmailService(): EmailService {
  const resendKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.EMAIL_FROM || "Hisaabo <noreply@hisaabo.in>";

  if (resendKey) {
    console.log("[email] Using Resend email service");
    return new ResendEmailService(resendKey, fromAddress);
  }

  console.log("[email] No RESEND_API_KEY — magic links will print to console");
  return new ConsoleEmailService();
}

export const emailService = createEmailService();
