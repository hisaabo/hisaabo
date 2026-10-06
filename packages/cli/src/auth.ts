import { HisaaboClient, HisaaboApiError, type AuthUser } from "./client.js";
import { getConfig, setConfig, clearConfig, requireAuth, getConfigPath } from "./config.js";
import { fatalError, EXIT, outputJSON, success, warn, sanitizeTerminal } from "./output.js";
import { validateApiUrl } from "./url.js";

/**
 * Authenticate using a long-lived API key (hisaabo_key_...).
 * Validates the token by calling auth.me, then stores it in config.
 */
export async function loginWithToken(apiUrl: string, token: string): Promise<void> {
  const base = validateApiUrl(apiUrl);

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

  const businesses = await listBusinessesOrExit(base, token);
  const selected = await selectBusiness(businesses);

  persistSession(base, token, selected, user.tenantId);

  success(`Authenticated as ${user.name ?? user.email} (${user.email}) via API key`);
  console.log("  Active business: " + selected.name);
  console.log("  Config saved to " + getConfigPath() + "\n");
}

async function listBusinessesOrExit(base: string, token: string): Promise<BusinessSummary[]> {
  const authedClient = new HisaaboClient({ apiUrl: base, token, tenantId: "", businessId: "" });
  let businesses: BusinessSummary[];
  try {
    businesses = await authedClient.business.list();
  } catch {
    businesses = [];
  }
  if (businesses.length === 0) {
    fatalError("No businesses found for this account.", EXIT.GENERAL);
  }
  return businesses;
}

async function selectBusiness(businesses: BusinessSummary[]): Promise<BusinessSummary> {
  console.log("\n  You have access to " + businesses.length + " business" + (businesses.length > 1 ? "es" : "") + ":\n");
  console.log("   #  Business" + " ".repeat(22) + "GSTIN" + " ".repeat(15) + "Role");
  console.log("  " + "─".repeat(58));
  businesses.forEach((b, i) => {
    const name = sanitizeTerminal(b.name).padEnd(26);
    const gstin = sanitizeTerminal(b.gstin ?? "-").padEnd(19);
    console.log(`   ${i + 1}  ${name} ${gstin} ${sanitizeTerminal(b.gstRegistrationType ?? "member")}`);
  });
  console.log();

  let selected = businesses[0];
  if (businesses.length > 1 && !process.stdin.isTTY) {
    warn(`Non-interactive login: using the first business (${sanitizeTerminal(businesses[0]!.name)}). Run "hisaabo switch" in a terminal to change.`);
  } else if (businesses.length > 1) {
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
  return selected;
}

/** Write credentials to disk only once login fully succeeded. */
function persistSession(apiUrl: string, token: string, business: BusinessSummary, tenantId?: string | null): void {
  clearConfig();
  setConfig({
    apiUrl,
    token,
    businessId: business.id,
    businessName: business.name,
    // Only the tenant reported by the server; never guess from a business id.
    tenantId: tenantId ?? undefined,
    tokenCreatedAt: Date.now(),
  });
}

// Type aliases used locally (mirrors what the client returns)
type BusinessSummary = { id: string; name: string; gstin?: string | null; gstRegistrationType?: string | null };

export async function login(apiUrl: string, email: string, password: string): Promise<void> {
  const base = validateApiUrl(apiUrl);

  // Use a temporary client without auth for login
  const client = new HisaaboClient({
    apiUrl: base,
    token: "",
    tenantId: "",
    businessId: "",
  });

  try {
    const result = await client.auth.login({ email, password });
    const token = result.sessionId;
    const authedClient = new HisaaboClient({ apiUrl: base, token, tenantId: "", businessId: "" });
    const me = await authedClient.auth.me().catch(() => undefined);

    const businesses = await listBusinessesOrExit(base, token);
    const selected = await selectBusiness(businesses);

    persistSession(base, token, selected, me?.tenantId);

    success(`Active business: ${selected.name}`);
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
    console.log(`  User:     ${user.name ?? "-"} <${user.email}>`);
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
