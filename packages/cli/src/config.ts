import Conf from "conf";
import { fatalError } from "./output.js";

interface ConfigSchema {
  apiUrl: string;
  token: string;
  tenantId: string;
  businessId: string;
  businessName: string;
}

const conf = new Conf<Partial<ConfigSchema>>({
  projectName: "hisaabo",
  projectSuffix: "",
  configName: "config",
});

export function getConfig(): Partial<ConfigSchema> {
  return conf.store;
}

export function setConfig(values: Partial<ConfigSchema>): void {
  for (const [k, v] of Object.entries(values)) {
    conf.set(k as keyof ConfigSchema, v as string);
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
  const cfg = getConfig();
  if (!cfg.token || !cfg.apiUrl || !cfg.businessId || !cfg.tenantId) {
    fatalError("Not authenticated. Run: hisaabo login", 3);
  }
  return cfg as ConfigSchema;
}

export function getConfigPath(): string {
  return conf.path;
}
