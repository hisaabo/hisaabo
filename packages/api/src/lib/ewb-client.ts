/**
 * ewb-client.ts — NIC E-Way Bill API client for Hisaabo.
 *
 * WHY THIS FILE EXISTS:
 * The NIC E-Way Bill portal (ewb.nic.in) exposes a REST API for generating,
 * cancelling and managing e-way bills. This client wraps that API and handles:
 *   - Session-level token caching (tokens valid for 6 hours)
 *   - RSA public-key encryption of the app secret (per NIC auth spec)
 *   - AES decryption of the sek (session encryption key) returned by /authenticate
 *   - Automatic re-auth on token expiry
 *
 * E-Way Bill auth is structurally identical to IRP auth but uses different base
 * URLs and endpoint paths — so this is a standalone client (no import from irp-client).
 *
 * Sandbox:    https://ewb-apisandbox.nic.in
 * Production: https://ewb.nic.in
 *
 * Token cache is per-businessId so multi-business environments stay isolated.
 */

import crypto from "crypto";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EWBConfig {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  gstin: string;
  sandbox?: boolean;
}

interface TokenCacheEntry {
  authToken: string;
  sek: string; // session encryption key (AES, base64)
  expiresAt: Date;
}

export interface EWBItemPayload {
  productName: string;
  productDesc: string;
  hsnCode: string;
  quantity: number;
  qtyUnit: string;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  cessRate: number;
  taxableAmount: number;
}

export interface GenerateEWBPayload {
  supplyType: "O" | "I";          // O = outward, I = inward
  subSupplyType: string;           // 1 = supply, 2 = import, 3 = export, etc.
  docType: "INV" | "CRN" | "DBN";
  docNo: string;
  docDate: string;                 // DD/MM/YYYY
  fromGstin: string;
  fromTrdName: string;
  fromAddr1: string;
  fromPlace: string;
  fromPincode: number;
  fromStateCode: number;
  toGstin: string;
  toTrdName: string;
  toAddr1: string;
  toPlace: string;
  toPincode: number;
  toStateCode: number;
  totalValue: number;
  cgstValue: number;
  sgstValue: number;
  igstValue: number;
  cessValue: number;
  transMode: string;    // "1" = road, "2" = rail, "3" = air, "4" = ship
  transDistance: number;
  transporterId?: string;
  transporterName?: string;
  transDocNo?: string;
  transDocDate?: string;
  vehicleNo?: string;
  vehicleType?: string; // "R" = regular, "O" = over-dimensional
  itemList: EWBItemPayload[];
}

export interface EWBGenerateResponse {
  ewayBillNo: string;
  ewayBillDate: string;
  validUpto: string;
}

export interface EWBCancelResponse {
  ewayBillNo: string;
  cancelDate: string;
}

export interface EWBVehicleUpdateResponse {
  ewayBillNo: string;
  transUpdateDate: string;
  validUpto: string;
}

// ── Token cache (in-memory, keyed by businessId) ──────────────────────────────

const tokenCache = new Map<string, TokenCacheEntry>();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Encrypt appSecret using the NIC public key via RSA-OAEP.
 * NIC requires the app secret encrypted with their RSA public key.
 *
 * In sandbox mode a well-known test public key is used. In production
 * the key is fetched or configured. For our purposes we accept the key
 * as part of the config / environment.
 */
function encryptWithPublicKey(data: string, publicKeyPem: string): string {
  const buffer = Buffer.from(data, "utf-8");
  const encrypted = crypto.publicEncrypt(
    {
      key: publicKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    buffer,
  );
  return encrypted.toString("base64");
}

/**
 * Decrypt the sek (session encryption key) returned by /authenticate.
 * NIC encrypts the sek with our app secret via AES-256-ECB.
 */
function decryptSek(encryptedSek: string, appSecret: string): string {
  // NIC uses the first 32 bytes of appSecret as the AES key
  const key = Buffer.from(appSecret.slice(0, 32), "utf-8");
  const decipher = crypto.createDecipheriv("aes-256-ecb", key, null);
  decipher.setAutoPadding(true);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedSek, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("base64");
}

/**
 * Encrypt request data using the sek (session encryption key).
 * All NIC API payloads are AES-encrypted with the sek.
 */
function encryptData(data: unknown, sek: string): string {
  const plaintext = JSON.stringify(data);
  const key = Buffer.from(sek, "base64");
  const _iv = Buffer.alloc(16, 0); // NIC uses zero IV for ECB-mode compat; AES-256-ECB
  const cipher = crypto.createCipheriv("aes-256-ecb", key, null);
  cipher.setAutoPadding(true);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf-8")),
    cipher.final(),
  ]);
  return encrypted.toString("base64");
}

/**
 * Decrypt API response data using the sek.
 */
function decryptData(encryptedData: string, sek: string): unknown {
  const key = Buffer.from(sek, "base64");
  const decipher = crypto.createDecipheriv("aes-256-ecb", key, null);
  decipher.setAutoPadding(true);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedData, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf-8"));
}

// ── EWBClient ─────────────────────────────────────────────────────────────────

export class EWBClient {
  private readonly baseUrl: string;
  // config is public so the router can override gstin per-call without recreating the client
  public config: EWBConfig;
  // publicKeyPem is only needed when real RSA encryption is required.
  // In test/dev environments callers can leave it blank and the auth call
  // will skip encryption (the sandbox accepts plain-text secrets too).
  private readonly publicKeyPem: string;

  constructor(config: EWBConfig, publicKeyPem = "") {
    this.config = config;
    this.publicKeyPem = publicKeyPem;
    this.baseUrl = config.sandbox
      ? "https://ewb-apisandbox.nic.in"
      : "https://ewb.nic.in";
  }

  // ── Auth ────────────────────────────────────────────────────────────────────

  /**
   * Authenticate with NIC and obtain an auth token + session encryption key.
   * Tokens are cached in memory for 6 hours (NIC's stated validity window).
   *
   * @param businessId - used as the cache key so each business gets its own token
   */
  async authenticate(businessId: string): Promise<TokenCacheEntry> {
    const cached = tokenCache.get(businessId);
    if (cached && cached.expiresAt > new Date()) {
      return cached;
    }

    // Encrypt client secret with NIC RSA public key if available
    const appSecret = this.publicKeyPem
      ? encryptWithPublicKey(this.config.clientSecret, this.publicKeyPem)
      : this.config.clientSecret;

    const url = `${this.baseUrl}/ewbapi/v1.03/authenticate`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "ACCESSTOKEN",
        username: this.config.username,
        password: this.config.password,
        gstin: this.config.gstin,
        client_id: this.config.clientId,
        client_secret: appSecret,
      }),
    });

    if (!res.ok) {
      throw new Error(`EWB auth HTTP ${res.status}: ${await res.text()}`);
    }

    const json = (await res.json()) as {
      status: string;
      data?: {
        authtoken: string;
        sek: string;
        tokenExpiry?: string;
      };
      error?: { message: string };
    };

    if (json.status !== "1" || !json.data) {
      throw new Error(`EWB auth failed: ${json.error?.message ?? "Unknown error"}`);
    }

    const sek = decryptSek(json.data.sek, this.config.clientSecret);

    // Tokens are valid for 6 hours; cache with 5-minute safety margin
    const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000 - 5 * 60 * 1000);

    const entry: TokenCacheEntry = {
      authToken: json.data.authtoken,
      sek,
      expiresAt,
    };

    tokenCache.set(businessId, entry);
    return entry;
  }

  // ── Private API call helper ──────────────────────────────────────────────────

  private async call<T>(
    businessId: string,
    endpoint: string,
    method: "GET" | "POST",
    payload?: unknown,
  ): Promise<T> {
    const { authToken, sek } = await this.authenticate(businessId);

    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      authtoken: authToken,
      gstin: this.config.gstin,
    };

    let body: string | undefined;
    if (method === "POST" && payload !== undefined) {
      const encrypted = encryptData(payload, sek);
      body = JSON.stringify({ action: endpoint.split("/").pop(), data: encrypted });
    }

    const res = await fetch(url, { method, headers, ...(body !== undefined && { body }) });

    if (!res.ok) {
      throw new Error(`EWB API ${endpoint} HTTP ${res.status}: ${await res.text()}`);
    }

    const json = (await res.json()) as {
      status: string;
      data?: string;
      error?: { message: string; errorCodes?: string };
    };

    if (json.status !== "1" || !json.data) {
      const msg = json.error?.message ?? "Unknown EWB API error";
      const codes = json.error?.errorCodes ?? "";
      throw new Error(`EWB ${endpoint} failed: ${msg}${codes ? ` [${codes}]` : ""}`);
    }

    return decryptData(json.data, sek) as T;
  }

  // ── Public API methods ───────────────────────────────────────────────────────

  /**
   * Generate a new E-Way Bill (POST /ewayapi/Generate).
   */
  async generateEWB(
    businessId: string,
    ewbData: GenerateEWBPayload,
  ): Promise<EWBGenerateResponse> {
    return this.call<EWBGenerateResponse>(
      businessId,
      "/ewbapi/v1.03/ewayapi/Generate",
      "POST",
      ewbData,
    );
  }

  /**
   * Cancel an existing E-Way Bill (POST /ewayapi/CancelEwb).
   * Must be called within 24 hours of generation.
   *
   * @param reason - cancellation reason code:
   *   1 = Data Entry Mistake, 2 = Order Cancelled, 3 = Others
   */
  async cancelEWB(
    businessId: string,
    ewbNo: string,
    reason: string,
  ): Promise<EWBCancelResponse> {
    return this.call<EWBCancelResponse>(
      businessId,
      "/ewbapi/v1.03/ewayapi/CancelEwb",
      "POST",
      { ewbNo, cancelRsnCode: reason, cancelRmrk: reason },
    );
  }

  /**
   * Update vehicle details (Part-B update, POST /ewayapi/UpdatePartB).
   */
  async updateVehicle(
    businessId: string,
    ewbNo: string,
    vehicleNo: string,
    fromPlace: string,
    fromState: number,
    reason: string,
    vehicleType = "R",
  ): Promise<EWBVehicleUpdateResponse> {
    return this.call<EWBVehicleUpdateResponse>(
      businessId,
      "/ewbapi/v1.03/ewayapi/UpdatePartB",
      "POST",
      {
        ewbNo,
        vehicleNo,
        fromPlace,
        fromState,
        reasonCode: reason,
        reasonRem: reason,
        transDocNo: "",
        transDocDate: "",
        transMode: "1",
        vehicleType,
      },
    );
  }

  /**
   * Extend EWB validity (POST /ewayapi/ExtValidity).
   * Can only be called within 8 hours before/after expiry.
   */
  async extendValidity(
    businessId: string,
    ewbNo: string,
    vehicleNo: string,
    fromPlace: string,
    fromStateCode: number,
    fromPincode: number,
    remainingDistance: number,
  ): Promise<{ ewayBillNo: string; validUpto: string }> {
    return this.call<{ ewayBillNo: string; validUpto: string }>(
      businessId,
      "/ewbapi/v1.03/ewayapi/ExtValidity",
      "POST",
      {
        ewbNo,
        vehicleNo,
        fromPlace,
        fromState: fromStateCode,
        fromPincode,
        remainingDistance,
        transMode: "1",
        extnRsnCode: "5", // Others
        extnRemarks: "Validity extension requested",
      },
    );
  }

  /**
   * Fetch details of an existing EWB (GET /ewayapi/GetEwb).
   */
  async getEWBDetails(
    businessId: string,
    ewbNo: string,
  ): Promise<Record<string, unknown>> {
    return this.call<Record<string, unknown>>(
      businessId,
      `/ewbapi/v1.03/ewayapi/GetEwb?ewbNo=${ewbNo}`,
      "GET",
    );
  }
}

// ── Validity calculation ───────────────────────────────────────────────────────

/**
 * Calculate EWB validity in hours based on NIC rules:
 *   - Regular cargo: 1 day (24h) for first 100km + 1 day per additional 100km
 *   - Over-dimensional cargo: 1 day (24h) for first 20km + 1 day per 20km
 *
 * Returns validity duration in hours.
 */
export function calculateEWBValidityHours(
  distanceKm: number,
  vehicleType: "regular" | "over_dimensional" = "regular",
): number {
  const kmPerDay = vehicleType === "over_dimensional" ? 20 : 100;
  const days = Math.ceil(distanceKm / kmPerDay);
  return days * 24;
}

/**
 * Compute the validUpto Date for an EWB given generation time and distance.
 */
export function computeValidUpto(
  generatedAt: Date,
  distanceKm: number,
  vehicleType: "regular" | "over_dimensional" = "regular",
): Date {
  const hours = calculateEWBValidityHours(distanceKm, vehicleType);
  return new Date(generatedAt.getTime() + hours * 60 * 60 * 1000);
}

/**
 * Map transport mode string to NIC code.
 */
export function transportModeCode(mode: string): string {
  switch (mode) {
    case "road":  return "1";
    case "rail":  return "2";
    case "air":   return "3";
    case "ship":  return "4";
    default:      return "1";
  }
}
