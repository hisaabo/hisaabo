import { HisaaboClient, HisaaboApiError } from "./client.js";
import { getConfig, setConfig, clearConfig, requireAuth, getConfigPath } from "./config.js";
import { fatalError, EXIT, outputJSON, success } from "./output.js";

/**
 * Authenticate using a long-lived API key (hisaabo_key_...).
 * Validates the token by calling auth.me, then stores it in config.
 */
export async function loginWithToken(apiUrl: string, token: string): Promise<void> {
  const base = apiUrl.replace(/\/$/, "");

  // Use a temporary client with the token but no business/tenant yet
  const client = new HisaaboClient({
    apiUrl: base,
    token,
    tenantId: "",
    businessId: "",
  });

  let user: AuthUser;
  try {
    user = await client.auth.me();
  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Invalid or expired API key.", EXIT.AUTH);
      if (err.code === "network_error") fatalError("Cannot reach server: " + err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e), EXIT.GENERAL);
    return; // unreachable — fatalError throws, but satisfies TS control flow
  }

  // Temporarily store the token so business.list() can authenticate
  setConfig({ apiUrl: base, token });

  const authedClient = new HisaaboClient({
    apiUrl: base,
    token,
    tenantId: "",
    businessId: "",
  });

  let businesses: BusinessSummary[];
  try {
    businesses = await authedClient.business.list();
  } catch {
    businesses = [];
  }

  if (businesses.length === 0) {
    fatalError("No businesses found for this account.", EXIT.GENERAL);
  }

  console.log("\n  You have access to " + businesses.length + " business" + (businesses.length > 1 ? "es" : "") + ":\n");
  console.log("   #  Business" + " ".repeat(22) + "GSTIN" + " ".repeat(15) + "Role");
  console.log("  " + "─".repeat(58));
  businesses.forEach((b, i) => {
    const name = b.name.padEnd(26);
    const gstin = (b.gstin ?? "-").padEnd(19);
    console.log(`   ${i + 1}  ${name} ${gstin} ${b.gstRegistrationType ?? "member"}`);
  });
  console.log();

  let selected = businesses[0];
  if (businesses.length > 1) {
    const readline = await import("readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) => {
      rl.question("  Select business [1]: ", resolve);
    });
    rl.close();
    const idx = parseInt(answer.trim() || "1", 10) - 1;
    selected = businesses[Math.max(0, Math.min(idx, businesses.length - 1))];
  }

  if (!selected) {
    fatalError("No business selected.", EXIT.GENERAL);
  }

  setConfig({
    businessId: selected.id,
    businessName: selected.name,
    tenantId: selected.id,
  });

  success(`Authenticated as ${user.name ?? user.email} (${user.email}) via API key`);
  console.log("  Active business: " + selected.name);
  console.log("  Config saved to " + getConfigPath() + "\n");
}

// Type aliases used locally (mirrors what the client returns)
type AuthUser = { id: string; email: string; name: string | null; role: string };
type BusinessSummary = { id: string; name: string; gstin?: string | null; gstRegistrationType?: string | null };

export async function login(apiUrl: string, email: string, password: string): Promise<void> {
  // Normalize URL
  const base = apiUrl.replace(/\/$/, "");

  // Use a temporary client without auth for login
  const client = new HisaaboClient({
    apiUrl: base,
    token: "",
    tenantId: "",
    businessId: "",
  });

  try {
    const result = await client.auth.login({ email, password });
    // After login, fetch businesses
    const authedClient = new HisaaboClient({
      apiUrl: base,
      token: result.sessionId,
      tenantId: "",
      businessId: "",
    });
    const businesses = await authedClient.business.list();

    if (businesses.length === 0) {
      fatalError("No businesses found for this account.", EXIT.GENERAL);
    }

    setConfig({
      apiUrl: base,
      token: result.sessionId,
    });

    // Return businesses for caller to handle selection
    console.log("\n  You have access to " + businesses.length + " business" + (businesses.length > 1 ? "es" : "") + ":\n");
    console.log("   #  Business" + " ".repeat(22) + "GSTIN" + " ".repeat(15) + "Role");
    console.log("  " + "─".repeat(58));
    businesses.forEach((b, i) => {
      const name = b.name.padEnd(26);
      const gstin = (b.gstin ?? "-").padEnd(19);
      console.log(`   ${i + 1}  ${name} ${gstin} ${b.gstRegistrationType ?? "member"}`);
    });
    console.log();

    // Default to first if only one
    let selected = businesses[0];
    if (businesses.length > 1) {
      const readline = await import("readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>((resolve) => {
        rl.question("  Select business [1]: ", resolve);
      });
      rl.close();
      const idx = parseInt(answer.trim() || "1", 10) - 1;
      selected = businesses[Math.max(0, Math.min(idx, businesses.length - 1))];
    }

    if (!selected) {
      fatalError("No business selected.", EXIT.GENERAL);
    }

    setConfig({
      businessId: selected.id,
      businessName: selected.name,
      tenantId: selected.id, // fallback; real tenantId may differ
    });

    success(`Active business: ${selected.name}`);
    const cfg = getConfig();
    console.log("  Config saved to " + getConfigPath());
    console.log("\n  You can switch businesses anytime with:");
    console.log("    hisaabo business switch\n");
  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Invalid email or password.", EXIT.AUTH);
      if (err.code === "network_error") fatalError("Cannot reach server: " + err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e), EXIT.GENERAL);
  }
}

export async function logout(): Promise<void> {
  if (!getConfig().token) {
    console.log("Not logged in.");
    return;
  }
  try {
    const cfg = requireAuth();
    const client = new HisaaboClient(cfg);
    await client.auth.logout();
  } catch {
    // ignore errors on logout
  }
  clearConfig();
  success("Logged out.");
}

export async function whoami(jsonMode: boolean): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  try {
    const user = await client.auth.me();
    if (jsonMode) {
      outputJSON({ user, business: { id: cfg.businessId, name: cfg.businessName }, apiUrl: cfg.apiUrl });
      return;
    }
    console.log(`  User:     ${user.name} <${user.email}>`);
    console.log(`  Role:     ${user.role}`);
    console.log(`  Business: ${cfg.businessName} (${cfg.businessId})`);
    console.log(`  API:      ${cfg.apiUrl}`);
  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      fatalError(e.message, EXIT.GENERAL);
    }
    fatalError(String(e instanceof Error ? e.message : e), EXIT.GENERAL);
  }
}
