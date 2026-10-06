import Conf from "conf";
import { hostname, userInfo } from "os";
import { chmodSync, existsSync, writeFileSync } from "fs";
import { dirname } from "path";
import { createHash } from "crypto";
import { fatalError, warn } from "./output.js";
import { validateApiUrl } from "./url.js";
import type { HisaaboClient } from "./client.js";

interface ConfigSchema {
  apiUrl: string;
  token: string;
  tenantId: string;
  businessId: string;
  businessName: string;
  tokenCreatedAt: number;
}

/**
 * The token is stored in plaintext. The previous "encryption" key was derived
 * from public values (uid, hostname), so it protected nothing against anyone
 * able to read the file. Real protection is filesystem permissions: the file
 * is mode 0600 inside a 0700 directory. Anything running as this user can
 * still read it; use HISAABO_TOKEN for ephemeral/CI credentials instead.
 */
const CONF_OPTIONS = {
  projectName: "hisaabo",
  projectSuffix: "",
  configName: "config",
  configFileMode: 0o600,
};

/** Key used by older CLI versions; only needed to read their config files. */
function legacyEncryptionKey(): string {
  let uid: string;
  try {
    uid = String(userInfo().uid);
  } catch {
    uid = String(process.getuid?.() ?? process.pid);
  }
  return createHash("sha256").update(`${uid}:${hostname()}:hisaabo-cli`).digest("hex");
}

function hardenPermissions(file: string): void {
  try {
    chmodSync(dirname(file), 0o700);
    if (existsSync(file)) chmodSync(file, 0o600);
  } catch {
    // Not supported on every platform/filesystem
  }
}

function openConf(): Conf<Partial<ConfigSchema>> {
  let c: Conf<Partial<ConfigSchema>>;
  try {
    c = new Conf<Partial<ConfigSchema>>(CONF_OPTIONS);
  } catch {
    // Config written by an older version (encrypted) — migrate to plaintext.
    try {
      const legacy = new Conf<Partial<ConfigSchema>>({ ...CONF_OPTIONS, encryptionKey: legacyEncryptionKey() });
      writeFileSync(legacy.path, JSON.stringify(legacy.store), { mode: 0o600 });
    } catch {
      new Conf<Partial<ConfigSchema>>({ ...CONF_OPTIONS, clearInvalidConfig: true });
      warn("Saved credentials could not be read and were discarded. Run: hisaabo login");
    }
    c = new Conf<Partial<ConfigSchema>>(CONF_OPTIONS);
  }
  hardenPermissions(c.path);
  return c;
}

let confInstance: Conf<Partial<ConfigSchema>> | undefined;
function conf(): Conf<Partial<ConfigSchema>> {
  return (confInstance ??= openConf());
}

export function getConfig(): Partial<ConfigSchema> {
  return conf().store;
}

export function setConfig(values: Partial<ConfigSchema>): void {
  for (const [k, v] of Object.entries(values)) {
    if (v !== undefined) {
      conf().set(k as keyof ConfigSchema, v as string);
    }
  }
  hardenPermissions(conf().path);
}

export function clearConfig(): void {
  conf().clear();
  hardenPermissions(conf().path);
}

export function isAuthenticated(): boolean {
  const cfg = getConfig();
  return !!(cfg.token && cfg.apiUrl && cfg.businessId);
}

export function requireAuth(): ConfigSchema {
  // Environment variables take priority — never persisted to disk (CI/scripts)
  const envToken = process.env["HISAABO_TOKEN"];
  const envUrl = process.env["HISAABO_API_URL"];
  if (envToken && envUrl) {
    return {
      apiUrl: validateApiUrl(envUrl),
      token: envToken,
      tenantId: process.env["HISAABO_TENANT_ID"] ?? "",
      businessId: process.env["HISAABO_BUSINESS_ID"] ?? "",
      businessName: process.env["HISAABO_BUSINESS_NAME"] ?? "",
      tokenCreatedAt: Date.now(),
    };
  }

  const cfg = getConfig();
  if (!cfg.token || !cfg.apiUrl || !cfg.businessId) {
    fatalError("Not authenticated. Run: hisaabo login", 3);
  }

  // Warn about expiring session tokens (not API keys)
  const isApiKey = cfg.token.startsWith("hisaabo_key_");
  if (!isApiKey && cfg.tokenCreatedAt) {
    const ageMs = Date.now() - cfg.tokenCreatedAt;
    const TWENTY_FIVE_DAYS = 25 * 24 * 60 * 60 * 1000;
    if (ageMs > TWENTY_FIVE_DAYS) {
      warn("Session expires soon. Run: hisaabo login");
    }
  }

  return { ...cfg, apiUrl: validateApiUrl(cfg.apiUrl), tenantId: cfg.tenantId ?? "" } as ConfigSchema;
}

/**
 * Like requireAuth but only requires token + apiUrl + tenantId.
 * Used by tenant-level operations (backup export/restore) that don't need
 * a business to be selected.
 */
export interface TenantAuthConfig {
  apiUrl: string;
  token: string;
  tenantId: string;
  businessId: string;
  businessName: string;
  tokenCreatedAt: number;
}

export function requireTenantAuth(): TenantAuthConfig {
  const envToken = process.env["HISAABO_TOKEN"];
  const envUrl = process.env["HISAABO_API_URL"];
  if (envToken && envUrl) {
    return {
      apiUrl: validateApiUrl(envUrl),
      token: envToken,
      tenantId: process.env["HISAABO_TENANT_ID"] ?? "",
      businessId: process.env["HISAABO_BUSINESS_ID"] ?? "",
      businessName: process.env["HISAABO_BUSINESS_NAME"] ?? "",
      tokenCreatedAt: Date.now(),
    };
  }

  const cfg = getConfig();
  if (!cfg.token || !cfg.apiUrl || !cfg.tenantId) {
    fatalError("Not authenticated. Run: hisaabo login", 3);
  }

  const isApiKey = cfg.token.startsWith("hisaabo_key_");
  if (!isApiKey && cfg.tokenCreatedAt) {
    const ageMs = Date.now() - cfg.tokenCreatedAt;
    const TWENTY_FIVE_DAYS = 25 * 24 * 60 * 60 * 1000;
    if (ageMs > TWENTY_FIVE_DAYS) {
      warn("Session expires soon. Run: hisaabo login");
    }
  }

  return { ...cfg, apiUrl: validateApiUrl(cfg.apiUrl) } as TenantAuthConfig;
}

export function getConfigPath(): string {
  return conf().path;
}

/**
 * Check if the system is under maintenance and warn the user.
 * Called after requireAuth() in command handlers.
 * Non-fatal — prints warning and continues (the API will block tenant ops anyway).
 */
export async function checkMaintenance(client: HisaaboClient): Promise<void> {
  try {
    const status = await client.system.maintenanceStatus();
    if (status.enabled) {
      warn(`System is under maintenance: ${status.message || "Please try again later."}`);
      if (status.endsAt) {
        const end = new Date(status.endsAt).toLocaleString();
        warn(`Estimated end: ${end}`);
      }
    } else if (status.startsAt && new Date(status.startsAt) > new Date()) {
      const start = new Date(status.startsAt).toLocaleString();
      warn(`Scheduled maintenance: ${start}${status.message ? ` — ${status.message}` : ""}`);
    }
  } catch {
    // Silently ignore — don't block CLI startup if status check fails
  }
}
