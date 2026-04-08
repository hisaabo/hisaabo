/**
 * irp-client.ts — NIC IRP (Invoice Registration Portal) client for E-Invoicing.
 *
 * WHY THIS FILE EXISTS:
 * Indian GST law (Section 31A) mandates e-invoicing for businesses above ₹5 crore
 * turnover. This client handles the NIC IRP API protocol:
 *   1. Auth: RSA-encrypt AppKey → get AuthToken + SEK (Session Encryption Key)
 *   2. All request/response payloads are AES-256-ECB encrypted with SEK
 *   3. Token valid 6h (production) / 1h (sandbox)
 *
 * Rate limiting: simple in-memory queue at 100 req/min to stay within NIC limits.
 * Token caching: stored in eInvoiceConfigs to survive process restarts.
 */

import { createHash, createCipheriv, createDecipheriv, publicEncrypt, constants, randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { eInvoiceConfigs } from "@hisaabo/db";
import type { TenantDatabase } from "../trpc.js";

// ── NIC IRP endpoints ─────────────────────────────────────────────────────────

const SANDBOX_BASE = "https://einv-apisandbox.nic.in";
const PRODUCTION_BASE = "https://einvoice1.gst.gov.in";

// NIC IRP sandbox RSA public key (PEM format) for encrypting AppKey
// Source: https://einvoice1.gst.gov.in/Others/APIDOC
const NIC_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3pMCDIFfrqFiTbAlPAtR
zW2VFVFbQ4wjd8z3gqEnO2b6kf5kZjbRCJv7dO8BjPnJ/s7p8xfbUEuqtpDLIXX
OFKAm6Qm7k5JknG0tkbwrEmEo7+h2MXk5W00x9vM77mZnFDKW8P8CaFPJLX1w5m
pGH2CiMcYVN3SZIM0fzRZjjPuRnHTSwJjIHjAH0sFe4hHsS0sVIpCEn3tRl7b2K
vHEiDLDfCZl2yPSTTW94XHQG3IJRJ0z0Hq7WQqQH3HXmn6PUPKBi4OSmqn9kGHa
f4R9bImMnLKFYJdB7w1JwCO2M8CMrqLBOA9bGG5Q1u0FpNLGJj7tl9dMvr/k3i/
MQIDAQAB
-----END PUBLIC KEY-----`;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface IRPAuthResponse {
  Status: string;
  Data?: {
    AuthToken: string;
    TokenExpiry: string; // "02/04/2026 15:30:00"
    Sek: string; // AES-encrypted SEK
  };
  ErrorDetails?: Array<{ ErrorCode: string; ErrorMessage: string }>;
}

export interface IRPGenerateIRNResponse {
  Status: string;
  Data?: {
    Irn: string;
    AckNo: string;
    AckDt: string; // "2026-04-02 12:00:00"
    SignedQRCode: string;
    SignedInvoice: string;
  };
  ErrorDetails?: Array<{ ErrorCode: string; ErrorMessage: string }>;
}

export interface IRPCancelIRNResponse {
  Status: string;
  Data?: {
    Irn: string;
    CancelDate: string;
  };
  ErrorDetails?: Array<{ ErrorCode: string; ErrorMessage: string }>;
}

export interface IRPInvoiceJson {
  Version: string;
  TranDtls: {
    TaxSch: string;
    SupTyp: string;
    RegRev: string;
    EcmGstin?: string;
    IgstOnIntra?: string;
  };
  DocDtls: {
    Typ: string; // INV | CRN | DBN
    No: string;
    Dt: string; // DD/MM/YYYY
  };
  SellerDtls: {
    Gstin: string;
    LglNm: string;
    TrdNm?: string;
    Addr1: string;
    Addr2?: string;
    Loc: string;
    Pin: number;
    Stcd: string;
    Ph?: string;
    Em?: string;
  };
  BuyerDtls: {
    Gstin: string;
    LglNm: string;
    TrdNm?: string;
    Pos: string;
    Addr1: string;
    Addr2?: string;
    Loc: string;
    Pin: number;
    Stcd: string;
    Ph?: string;
    Em?: string;
  };
  ItemList: Array<{
    SlNo: string;
    PrdDesc: string;
    IsServc: string; // Y | N
    HsnCd: string;
    Qty: number;
    Unit: string;
    UnitPrice: number;
    TotAmt: number;
    Discount: number;
    PreTaxVal?: number;
    AssAmt: number;
    GstRt: number;
    IgstAmt: number;
    CgstAmt: number;
    SgstAmt: number;
    CesRt?: number;
    CesAmt?: number;
    CesNonAdvlAmt?: number;
    StateCesRt?: number;
    StateCesAmt?: number;
    StateCesNonAdvlAmt?: number;
    OthChrg?: number;
    TotItemVal: number;
  }>;
  ValDtls: {
    AssVal: number;
    CgstVal: number;
    SgstVal: number;
    IgstVal: number;
    CesVal?: number;
    StCesVal?: number;
    Discount?: number;
    OthChrg?: number;
    RndOffAmt?: number;
    TotInvVal: number;
    TotInvValFc?: number;
  };
  PayDtls?: {
    Nm?: string;
    AccDet?: string;
    Mode?: string;
    FinInsBr?: string;
    PayTerm?: string;
    PayInstr?: string;
    CrTrn?: string;
    DirDr?: string;
    CrDay?: number;
    PaidAmt?: number;
    PaymtDue?: number;
  };
  AddlDocDtls?: Array<{
    Url?: string;
    Docs?: string;
    Info?: string;
  }>;
}

export type EInvoiceConfig = {
  id: string;
  businessId: string;
  gstin: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  authToken: string | null;
  tokenExpiresAt: Date | null;
  isSandbox: boolean;
  isEnabled: boolean;
};

// ── Rate limiter ───────────────────────────────────────────────────────────────

class RateLimiter {
  private queue: Array<() => void> = [];
  private requestCount = 0;
  private resetTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly maxPerMinute: number;

  constructor(maxPerMinute = 100) {
    this.maxPerMinute = maxPerMinute;
  }

  async throttle(): Promise<void> {
    if (this.requestCount < this.maxPerMinute) {
      this.requestCount++;
      if (!this.resetTimeout) {
        this.resetTimeout = setTimeout(() => {
          this.requestCount = 0;
          this.resetTimeout = null;
          // Drain queued requests
          const pending = this.queue.splice(0, this.maxPerMinute);
          for (const resolve of pending) resolve();
        }, 60_000);
      }
      return;
    }

    // Wait in queue
    await new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
    this.requestCount++;
  }
}

const globalRateLimiter = new RateLimiter(100);

// ── AES-256-ECB helpers ────────────────────────────────────────────────────────

function aesEncrypt(data: string, keyBytes: Buffer): string {
  // NIC uses AES-256-ECB with PKCS7 padding
  const cipher = createCipheriv("aes-256-ecb", keyBytes, null);
  cipher.setAutoPadding(true);
  const encrypted = Buffer.concat([cipher.update(data, "utf8"), cipher.final()]);
  return encrypted.toString("base64");
}

function aesDecrypt(encryptedBase64: string, keyBytes: Buffer): string {
  const decipher = createDecipheriv("aes-256-ecb", keyBytes, null);
  decipher.setAutoPadding(true);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

// ── IRPClient ─────────────────────────────────────────────────────────────────

export class IRPClient {
  private config: EInvoiceConfig;
  private db: TenantDatabase;
  private appKey: Buffer | null = null;
  private sek: Buffer | null = null;
  private authToken: string | null = null;
  private tokenExpiresAt: Date | null = null;

  constructor(config: EInvoiceConfig, db: TenantDatabase) {
    this.config = config;
    this.db = db;
    // Restore cached token from config
    if (config.authToken && config.tokenExpiresAt) {
      this.authToken = config.authToken;
      this.tokenExpiresAt = config.tokenExpiresAt;
    }
  }

  private get baseUrl(): string {
    return this.config.isSandbox ? SANDBOX_BASE : PRODUCTION_BASE;
  }

  private isTokenValid(): boolean {
    if (!this.authToken || !this.tokenExpiresAt) return false;
    // Refresh 10 minutes before expiry
    const bufferMs = 10 * 60 * 1000;
    return this.tokenExpiresAt.getTime() - Date.now() > bufferMs;
  }

  /**
   * Authenticate with IRP and obtain AuthToken + SEK.
   * Token is cached in DB for reuse across requests/processes.
   */
  async authenticate(): Promise<void> {
    if (this.isTokenValid() && this.sek) return;

    // Generate fresh 32-byte AppKey
    this.appKey = randomBytes(32);

    // RSA-encrypt AppKey with NIC public key (PKCS1 v1.5)
    const encryptedAppKey = publicEncrypt(
      {
        key: NIC_PUBLIC_KEY_PEM,
        padding: constants.RSA_PKCS1_PADDING,
      },
      this.appKey,
    ).toString("base64");

    const body = {
      Data: {
        UserName: this.config.username,
        Password: createHash("sha256").update(this.config.password).digest("base64"),
        AppKey: encryptedAppKey,
        ForceRefreshAccessToken: false,
      },
    };

    await globalRateLimiter.throttle();

    const response = await fetch(`${this.baseUrl}/eivital/v1.04/auth`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "client_id": this.config.clientId,
        "client_secret": this.config.clientSecret,
        "Gstin": this.config.gstin,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new IRPError(`Auth HTTP error: ${response.status}`, "AUTH_HTTP_ERROR");
    }

    const result = await response.json() as IRPAuthResponse;

    if (result.Status !== "1" || !result.Data) {
      const errMsg = result.ErrorDetails?.[0]?.ErrorMessage ?? "Authentication failed";
      throw new IRPError(errMsg, "AUTH_FAILED");
    }

    // Decrypt SEK using AppKey
    const sekEncrypted = result.Data.Sek;
    this.sek = Buffer.from(aesDecrypt(sekEncrypted, this.appKey), "base64");

    // Parse token expiry — NIC format: "DD/MM/YYYY HH:MM:SS"
    const expiry = parsNICDateTime(result.Data.TokenExpiry);
    this.authToken = result.Data.AuthToken;
    this.tokenExpiresAt = expiry;

    // Persist token to DB for reuse
    await this.db.update(eInvoiceConfigs)
      .set({
        authToken: this.authToken,
        tokenExpiresAt: this.tokenExpiresAt,
        updatedAt: new Date(),
      })
      .where(eq(eInvoiceConfigs.id, this.config.id));
  }

  private async ensureAuthenticated(): Promise<void> {
    if (!this.isTokenValid() || !this.sek) {
      await this.authenticate();
    }
  }

  private async callApi<T>(
    method: "GET" | "POST",
    path: string,
    requestData?: unknown,
  ): Promise<T> {
    await this.ensureAuthenticated();
    await globalRateLimiter.throttle();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "client_id": this.config.clientId,
      "client_secret": this.config.clientSecret,
      "Gstin": this.config.gstin,
      "AuthToken": this.authToken!,
      "user_name": this.config.username,
    };

    let body: string | undefined;
    if (requestData !== undefined) {
      const plaintext = JSON.stringify(requestData);
      const encrypted = aesEncrypt(plaintext, this.sek!);
      body = JSON.stringify({ Data: encrypted });
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(method !== "GET" && { body }),
    });

    if (!response.ok) {
      const isRetryable = response.status >= 500;
      throw new IRPError(
        `IRP HTTP error: ${response.status}`,
        isRetryable ? "RETRYABLE" : "HTTP_ERROR",
        response.status,
      );
    }

    const result = await response.json() as { Status: string; Data?: string; ErrorDetails?: Array<{ ErrorCode: string; ErrorMessage: string }> };

    if (result.Status !== "1" || !result.Data) {
      const errCode = result.ErrorDetails?.[0]?.ErrorCode ?? "UNKNOWN";
      const errMsg = result.ErrorDetails?.[0]?.ErrorMessage ?? "IRP API error";
      throw new IRPError(errMsg, errCode);
    }

    // Decrypt response data
    const decryptedJson = aesDecrypt(result.Data, this.sek!);
    return JSON.parse(decryptedJson) as T;
  }

  /**
   * Submit invoice JSON to IRP and get IRN + QR code.
   */
  async generateIRN(invoiceJson: IRPInvoiceJson): Promise<{
    irn: string;
    ackNo: string;
    ackDt: Date;
    signedQrCode: string;
    signedInvoice: string;
  }> {
    const data = await this.callApi<IRPGenerateIRNResponse["Data"]>(
      "POST",
      "/eicore/v1.03/Invoice",
      invoiceJson,
    );

    if (!data) throw new IRPError("No data in generateIRN response", "NO_DATA");

    return {
      irn: data.Irn,
      ackNo: data.AckNo,
      ackDt: parseNICDateTimeISO(data.AckDt),
      signedQrCode: data.SignedQRCode,
      signedInvoice: data.SignedInvoice,
    };
  }

  /**
   * Cancel an IRN within 24 hours of generation.
   */
  async cancelIRN(
    irn: string,
    reason: string,
    remarks?: string,
  ): Promise<{ irn: string; cancelDate: Date }> {
    const data = await this.callApi<IRPCancelIRNResponse["Data"]>(
      "POST",
      "/eicore/v1.03/Invoice/Cancel",
      { Irn: irn, CnlRsn: reason, CnlRem: remarks ?? "" },
    );

    if (!data) throw new IRPError("No data in cancelIRN response", "NO_DATA");

    return {
      irn: data.Irn,
      cancelDate: parseNICDateTimeISO(data.CancelDate),
    };
  }

  /**
   * Fetch IRN details from IRP.
   */
  async getIRNDetails(irn: string): Promise<IRPGenerateIRNResponse["Data"]> {
    return this.callApi<IRPGenerateIRNResponse["Data"]>(
      "GET",
      `/eicore/v1.03/Invoice/irn/${irn}`,
    );
  }
}

// ── Custom error class ─────────────────────────────────────────────────────────

export class IRPError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "IRPError";
  }

  get isRetryable(): boolean {
    return this.code === "RETRYABLE" || (this.httpStatus !== undefined && this.httpStatus >= 500);
  }
}

// ── Date parsing helpers ───────────────────────────────────────────────────────

/** Parse NIC datetime "DD/MM/YYYY HH:MM:SS" → Date */
function parsNICDateTime(nicDt: string): Date {
  // Format: "02/04/2026 15:30:00"
  const [datePart, timePart] = nicDt.split(" ");
  const [dd, mm, yyyy] = (datePart ?? "").split("/");
  const [hh, min, ss] = (timePart ?? "00:00:00").split(":");
  return new Date(
    `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}+05:30`,
  );
}

/** Parse NIC datetime "YYYY-MM-DD HH:MM:SS" or "DD/MM/YYYY HH:MM:SS" → Date */
function parseNICDateTimeISO(nicDt: string): Date {
  if (!nicDt) return new Date();
  // If it looks like ISO format (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}/.test(nicDt)) {
    return new Date(nicDt.replace(" ", "T") + "+05:30");
  }
  return parsNICDateTime(nicDt);
}
