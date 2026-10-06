import { Command } from "commander";
import * as readline from "readline";
import { loginWithBrowser, loginWithToken, logout, whoami } from "../../auth.js";
import { setConfig, requireAuth } from "../../config.js";
import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { fatalError, success, warn, EXIT, outputJSON } from "../../output.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function ask(rl: readline.Interface, q: string): Promise<string> {
  return new Promise<string>((res) => rl.question(q, res));
}

/** Read an API key from stdin (all of it, trailing newline trimmed). */
async function readSecretFromStdin(flag: string): Promise<string> {
  if (process.stdin.isTTY) {
    fatalError(`${flag} expects the value piped on stdin`, EXIT.USAGE);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const value = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
  if (!value) fatalError(`No value received on stdin for ${flag}`, EXIT.USAGE);
  return value;
}

// ── Commands ─────────────────────────────────────────────────────────────────

export function registerAuthCommands(program: Command): void {
  // ── login ─────────────────────────────────────────────────────────────────

  program
    .command("login")
    .description("Sign in through your browser (or with an API key via --token-stdin)")
    .option("--api-url <url>", "Server URL (env: HISAABO_API_URL)")
    .option("--web-url <url>", "Web app URL used for browser sign-in (env: HISAABO_WEB_URL)")
    .option("--token <token>", "API key (deprecated: visible in process list and shell history; use --token-stdin)")
    .option("--token-stdin", "Read an API key from stdin instead of using the browser")
    .action(async (opts) => {
      let apiUrl: string | undefined = opts.apiUrl ?? process.env["HISAABO_API_URL"];

      if (opts.token) warn("--token is deprecated (visible to other users via the process list). Use --token-stdin.");
      if (opts.tokenStdin) {
        // stdin carries the secret, so nothing else can be prompted for
        if (!apiUrl) fatalError("--api-url is required with --token-stdin", EXIT.USAGE);
        opts.token = await readSecretFromStdin("--token-stdin");
      }

      if (!apiUrl) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        console.log("\n  Hisaabo CLI\n  " + "─".repeat(11) + "\n");
        const u = await ask(rl, "  Server URL [http://localhost:3000]: ");
        rl.close();
        apiUrl = u.trim() || "http://localhost:3000";
      }

      if (opts.token) {
        await loginWithToken(apiUrl, opts.token);
        return;
      }

      await loginWithBrowser({ apiUrl, webUrl: opts.webUrl });
    });

  // ── logout ────────────────────────────────────────────────────────────────

  program
    .command("logout")
    .description("Log out and clear saved credentials")
    .option("--all", "Invalidate all sessions across all devices")
    .action(async (opts) => {
      if (opts.all) {
        const cfg = requireAuth();
        const client = new HisaaboClient(cfg);
        try {
          await client.auth.logoutAll();
          await logout();
          success("Logged out from all sessions.");
        } catch (e) {
          if (e instanceof HisaaboApiError) {
            if (e.hisaaboError.code === "unauthorized") {
              // Session already invalid — still clear local config
              await logout();
              success("Logged out from all sessions.");
              return;
            }
          }
          fatalError(String(e instanceof Error ? e.message : e));
        }
        return;
      }
      await logout();
    });

  // ── whoami ────────────────────────────────────────────────────────────────

  program
    .command("whoami")
    .description("Show current user and active business")
    .option("--json", "JSON output")
    .action(async (opts) => {
      await whoami(!!opts.json);
    });

  // ── profile ───────────────────────────────────────────────────────────────

  const profile = program.command("profile").description("Manage your profile");

  profile
    .command("update-name <name>")
    .description("Update your display name")
    .action(async (name: string) => {
      const cfg = requireAuth();
      const client = new HisaaboClient(cfg);
      try {
        await client.auth.updateName({ name });
        success(`Name updated to: ${name}`);
      } catch (e) {
        if (e instanceof HisaaboApiError) {
          const err = e.hisaaboError;
          if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
          if (err.code === "validation_failed") fatalError(String(err.fields?.["name"]?.[0] ?? "Validation failed."), EXIT.VALIDATION);
        }
        fatalError(String(e instanceof Error ? e.message : e));
      }
    });

  // ── switch (business) ─────────────────────────────────────────────────────

  program
    .command("switch")
    .description("Switch active business")
    .option("--json", "JSON output")
    .action(async (opts) => {
      const cfg = requireAuth();
      const client = new HisaaboClient(cfg);
      try {
        const businesses = await client.business.list();
        if (opts.json) { outputJSON(businesses); return; }
        businesses.forEach((b, i) => {
          const active = b.id === cfg.businessId ? " [active]" : "";
          console.log(`  ${i + 1}  ${b.name.padEnd(28)}${active}`);
        });
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>((res) => rl.question("\n  Select: ", res));
        rl.close();
        const idx = parseInt(answer.trim(), 10) - 1;
        const selected = businesses[Math.max(0, Math.min(idx, businesses.length - 1))];
        if (!selected) fatalError("Invalid selection.", EXIT.USAGE);
        setConfig({ businessId: selected.id, businessName: selected.name });
        success(`Switched to: ${selected.name}`);
      } catch (e) {
        if (e instanceof HisaaboApiError) {
          if (e.hisaaboError.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
        }
        fatalError(String(e instanceof Error ? e.message : e));
      }
    });
}
