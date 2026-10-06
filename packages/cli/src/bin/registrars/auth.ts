import { Command } from "commander";
import * as readline from "readline";
import { login, loginWithToken, logout, whoami } from "../../auth.js";
import { setConfig, requireAuth } from "../../config.js";
import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { fatalError, success, warn, EXIT, outputJSON } from "../../output.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function ask(rl: readline.Interface, q: string): Promise<string> {
  return new Promise<string>((res) => rl.question(q, res));
}

/**
 * Prompt for a secret value (password, API token) with input hidden.
 * Characters are replaced with '*' as the user types.
 */
function askSecret(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, terminal: true });
    process.stdout.write(prompt);

    const chars: string[] = [];

    const cleanup = () => {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
    };

    // Restore terminal on unexpected signals
    const onSignal = () => { cleanup(); process.exit(130); };
    process.once("SIGTERM", onSignal);
    process.once("SIGHUP", onSignal);

    const onData = (key: Buffer) => {
      const ch = key.toString();
      if (ch === "\n" || ch === "\r") {
        process.removeListener("SIGTERM", onSignal);
        process.removeListener("SIGHUP", onSignal);
        cleanup();
        process.stdout.write("\n");
        rl.close();
        const result = chars.join("");
        chars.length = 0; // clear password from array
        resolve(result);
      } else if (ch === "\x7f" || ch === "\b") {
        // Backspace
        if (chars.length > 0) {
          chars.pop();
          process.stdout.write("\b \b");
        }
      } else if (ch === "\x03") {
        // Ctrl+C
        cleanup();
        process.stdout.write("\n");
        process.exit(130);
      } else if (ch.charCodeAt(0) >= 32) {
        chars.push(ch);
        process.stdout.write("*");
      }
    };

    if (process.stdin.isTTY) {
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      process.stdin.on("data", onData);
    } else {
      // Non-interactive: read line normally (piped input)
      rl.question("", (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

/** Read a secret from stdin (all of it, trailing newline trimmed). */
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
    .description("Authenticate and configure your Hisaabo server")
    .option("--api-url <url>", "Server URL")
    .option("--email <email>", "Email address")
    .option("--password <password>", "Password (deprecated: visible in process list and shell history; use --password-stdin)")
    .option("--password-stdin", "Read the password from stdin")
    .option("--token <token>", "API key (deprecated: visible in process list and shell history; use --token-stdin)")
    .option("--token-stdin", "Read the API key from stdin")
    .action(async (opts) => {
      let apiUrl = opts.apiUrl;

      if (opts.tokenStdin && opts.passwordStdin) {
        fatalError("Use only one of --token-stdin and --password-stdin", EXIT.USAGE);
      }
      if (opts.token) warn("--token is deprecated (visible to other users via the process list). Use --token-stdin.");
      if (opts.password) warn("--password is deprecated (visible to other users via the process list). Use --password-stdin.");
      if (opts.tokenStdin || opts.passwordStdin) {
        // stdin carries the secret, so nothing else can be prompted for
        apiUrl = apiUrl ?? process.env["HISAABO_API_URL"];
        if (!apiUrl) fatalError("--api-url is required with --token-stdin/--password-stdin", EXIT.USAGE);
        if (opts.passwordStdin && !opts.email) fatalError("--email is required with --password-stdin", EXIT.USAGE);
        if (opts.tokenStdin) opts.token = await readSecretFromStdin("--token-stdin");
        else opts.password = await readSecretFromStdin("--password-stdin");
      }

      // ── API key path — skip email/password flow ──
      if (opts.token) {
        if (!apiUrl) {
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          console.log("\n  Hisaabo CLI\n  " + "─".repeat(11) + "\n");
          const u = await ask(rl, "  Server URL [http://localhost:3000]: ");
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
        console.log("\n  Hisaabo CLI\n  " + "─".repeat(11) + "\n");
        if (!apiUrl) {
          const u = await ask(rl, "  Server URL [http://localhost:3000]: ");
          apiUrl = u.trim() || "http://localhost:3000";
        }
        if (!email) email = (await ask(rl, "  Email: ")).trim();
        rl.close();
        if (!password) {
          password = await askSecret("  Password: ");
        }
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
