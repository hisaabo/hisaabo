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
  sendMagicLink(to: string, magicLinkUrl: string): Promise<void>;
  sendInvitation(to: string, inviteUrl: string, businessName: string, inviterName: string | null): Promise<void>;
}

class ConsoleEmailService implements EmailService {
  async sendMagicLink(to: string, magicLinkUrl: string): Promise<void> {
    if (process.env.NODE_ENV === "production") {
      console.error("[email] FATAL: No email service configured for production. Set RESEND_API_KEY.");
      throw new Error("Email service not configured");
    }
    console.log("");
    console.log("╔══════════════════════════════════════════════════════════╗");
    console.log(`║  Magic link for ${to.padEnd(40)}║`);
    console.log("╠══════════════════════════════════════════════════════════╣");
    console.log(`║  ${magicLinkUrl}`);
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

  async sendMagicLink(to: string, magicLinkUrl: string): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.fromAddress,
        to,
        subject: "Sign in to Hisaabo",
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
            <h2 style="color: #1a1a1a; margin-bottom: 8px;">Sign in to Hisaabo</h2>
            <p style="color: #555; line-height: 1.6;">Click the button below to sign in. This link expires in 15 minutes and can only be used once.</p>
            <a href="${escapeHtml(magicLinkUrl)}" style="display: inline-block; padding: 12px 24px; background: #4f46e5; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 16px 0;">
              Sign in to Hisaabo
            </a>
            <p style="color: #999; font-size: 13px; margin-top: 24px;">If you didn't request this, you can safely ignore this email.</p>
            <p style="color: #bbb; font-size: 12px;">Or copy this link: ${escapeHtml(magicLinkUrl)}</p>
          </div>
        `,
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
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
            <h2 style="color: #1a1a1a; margin-bottom: 8px;">You've been invited to Hisaabo</h2>
            <p style="color: #555; line-height: 1.6;">${fromDisplay} has invited you to join <strong>${bizDisplay}</strong> on Hisaabo.</p>
            <a href="${escapeHtml(inviteUrl)}" style="display: inline-block; padding: 12px 24px; background: #4f46e5; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 16px 0;">
              Accept Invitation
            </a>
            <p style="color: #999; font-size: 13px; margin-top: 24px;">This invitation expires in 7 days. If you weren't expecting this, you can safely ignore this email.</p>
            <p style="color: #bbb; font-size: 12px;">Or copy this link: ${escapeHtml(inviteUrl)}</p>
          </div>
        `,
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
