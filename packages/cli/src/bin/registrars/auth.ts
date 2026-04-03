import { Command } from "commander";
import * as readline from "readline";
import { login, loginWithToken, logout, whoami } from "../../auth.js";
import { setConfig, requireAuth } from "../../config.js";
import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { fatalError, success, EXIT, outputJSON } from "../../output.js";

export function registerAuthCommands(program: Command): void {
  // ── login ─────────────────────────────────────────────────────────────────

  program
    .command("login")
    .description("Authenticate and configure your Hisaabo server")
    .option("--api-url <url>", "Server URL")
    .option("--email <email>", "Email address")
    .option("--password <password>", "Password")
    .option("--token <token>", "API key (hisaabo_key_...) for passwordless auth")
    .action(async (opts) => {
      let apiUrl = opts.apiUrl;

      // ── API key path — skip email/password flow ──
      if (opts.token) {
        if (!apiUrl) {
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          const ask = (q: string) => new Promise<string>((res) => rl.question(q, res));
          console.log("\n  Hisaabo CLI\n  " + "─".repeat(11) + "\n");
          const u = await ask("  Server URL [http://localhost:3000]: ");
          rl.close();
          apiUrl = u.trim() || "http://localhost:3000";
        }
        await loginWithToken(apiUrl, opts.token);
        return;
      }

      // ── Email/password path ──
      let email = opts.email;
      let password = opts.password;

      if (!apiUrl || !email || !password) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const ask = (q: string) => new Promise<string>((res) => rl.question(q, res));
        console.log("\n  Hisaabo CLI\n  " + "─".repeat(11) + "\n");
        if (!apiUrl) {
          const u = await ask("  Server URL [http://localhost:3000]: ");
          apiUrl = u.trim() || "http://localhost:3000";
        }
        if (!email) email = (await ask("  Email: ")).trim();
        if (!password) {
          // Hide password input if possible
          password = (await ask("  Password: ")).trim();
        }
        rl.close();
        console.log("\n  Tip: Generate an API key at Settings → API Keys for passwordless CLI access.\n");
      }

      await login(apiUrl, email, password);
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
