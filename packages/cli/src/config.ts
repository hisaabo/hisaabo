import Conf from "conf";
import { hostname, userInfo } from "os";
import { createHash } from "crypto";
import { fatalError, warn } from "./output.js";

interface ConfigSchema {
  apiUrl: string;
  token: string;
  tenantId: string;
  businessId: string;
  businessName: string;
  tokenCreatedAt: number;
}

/**
 * Derive a machine+user-specific encryption key. Prevents casual read of
 * the config file and stops accidental credential leaks in screenshots,
 * backups, or `cat` output. Not unbreakable — but the token at rest is
 * no longer plaintext.
 */
function deriveEncryptionKey(): string {
  let uid: string;
  try {
    uid = String(userInfo().uid);
  } catch {
    uid = String(process.getuid?.() ?? process.pid);
  }
  const raw = `${uid}:${hostname()}:hisaabo-cli`;
  return createHash("sha256").update(raw).digest("hex");
}

const conf = new Conf<Partial<ConfigSchema>>({
  projectName: "hisaabo",
  projectSuffix: "",
  configName: "config",
  encryptionKey: deriveEncryptionKey(),
  configFileMode: 0o600, // owner read/write only — prevents credential theft on shared systems
});

export function getConfig(): Partial<ConfigSchema> {
  return conf.store;
}

export function setConfig(values: Partial<ConfigSchema>): void {
  for (const [k, v] of Object.entries(values)) {
    if (v !== undefined) {
      conf.set(k as keyof ConfigSchema, v as string);
    }
  }
}

export function clearConfig(): void {
  conf.clear();
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
      apiUrl: envUrl,
      token: envToken,
      tenantId: process.env["HISAABO_TENANT_ID"] ?? "",
      businessId: process.env["HISAABO_BUSINESS_ID"] ?? "",
      businessName: process.env["HISAABO_BUSINESS_NAME"] ?? "",
      tokenCreatedAt: Date.now(),
    };
  }

  const cfg = getConfig();
  if (!cfg.token || !cfg.apiUrl || !cfg.businessId || !cfg.tenantId) {
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

  return cfg as ConfigSchema;
}

export function getConfigPath(): string {
  return conf.path;
}
