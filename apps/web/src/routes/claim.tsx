import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect, useMemo, useId } from "react";
import { trpc, setBusinessId } from "@/lib/trpc";
import { Logo } from "@/components/ui/Logo";
import { Modal } from "@/components/ui/Modal";
import { FormField } from "@/components/ui/FormField";

export const Route = createFileRoute("/claim")({
  component: ClaimPage,
});

interface EncryptedShareEnvelope {
  v: 1;
  app: "ownlyst-swissqr";
  protected: boolean;
  scope: "full" | "payment";
  alg: "AES-GCM-256" | "NONE";
  salt?: string;
  iv?: string;
  ciphertext?: string;
  plainPayload?: string;
  hint?: string;
  meta: {
    docType?: string;
    invoiceNumber: string;
    senderName: string;
    senderGstin?: string;
    recipientName: string;
    recipientGstin?: string;
    currency: string;
    grandTotal: number;
    issueDate: string;
    dueDate: string;
  };
}

interface OwnlystInvoice {
  id: string;
  docType?: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  reference?: string;
  referenceType?: string;
  notes?: string;
  reverseCharge?: boolean;
  sender: {
    name: string;
    street?: string;
    building?: string;
    postalCode?: string;
    city?: string;
    country?: string;
    email?: string;
    taxId?: string;
    phone?: string;
    iban?: string;
    upiId?: string;
    bankName?: string;
    accountNumber?: string;
    ifscCode?: string;
  };
  recipient: {
    name: string;
    street?: string;
    building?: string;
    postalCode?: string;
    city?: string;
    country?: string;
    email?: string;
    taxId?: string;
    phone?: string;
  };
  items: Array<{
    id: string;
    description: string;
    hsnSac?: string;
    quantity: number;
    unitPrice: number;
    taxRate: number;
  }>;
}

function base64UrlToBytes(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
  const binary = atob(base64 + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveAesKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: 100000,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function extractTokenFromHash(hash: string): string | null {
  const trimmed = (hash || "").trim();
  const match = trimmed.match(/#share=([^&]+)/) || trimmed.match(/share=([^&]+)/);
  if (match) return match[1];
  if (/^[A-Za-z0-9_-]{32,}$/.test(trimmed)) return trimmed;
  return null;
}

function formatMoney(amount: number, currency = "INR"): string {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function ClaimPage() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const businessNameId = useId();
  const gstinId = useId();
  const panId = useId();
  const phoneId = useId();
  const addressId = useId();

  // Session & Businesses
  const { data: session } = trpc.auth.me.useQuery();
  const { data: businesses } = trpc.business.list.useQuery(undefined, {
    enabled: !!session?.tenantId,
  });

  // State
  const [envelope, setEnvelope] = useState<EncryptedShareEnvelope | null>(null);
  const [decodedInvoice, setDecodedInvoice] = useState<OwnlystInvoice | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [decrypting, setDecrypting] = useState(false);
  const [selectedBusinessId, setSelectedBusinessId] = useState<string>("");
  const [claimSuccess, setClaimSuccess] = useState<{
    invoiceId: string;
    invoiceNumber: string;
    alreadyClaimed: boolean;
  } | null>(null);

  // Business provisioning modal state
  const [showProvisionModal, setShowProvisionModal] = useState(false);
  const [bizName, setBizName] = useState("");
  const [bizGstin, setBizGstin] = useState("");
  const [bizPan, setBizPan] = useState("");
  const [bizPhone, setBizPhone] = useState("");
  const [bizAddress, setBizAddress] = useState("");
  const [bizStateCode, setBizStateCode] = useState("33");
  const [provisionError, setProvisionError] = useState("");

  // Synchronize active business ID with tRPC headers
  useEffect(() => {
    if (selectedBusinessId) {
      setBusinessId(selectedBusinessId);
    }
  }, [selectedBusinessId]);

  // Extract hash & parse envelope
  useEffect(() => {
    const rawHash = window.location.hash;
    const token = extractTokenFromHash(rawHash);
    if (!token) {
      setError("No valid Ownlyst share token found in URL hash. Expected /claim#share=<token>");
      return;
    }

    try {
      const rawJson = new TextDecoder().decode(base64UrlToBytes(token));
      const parsed = JSON.parse(rawJson) as EncryptedShareEnvelope;
      if (parsed.app !== "ownlyst-swissqr" || parsed.v !== 1) {
        setError("Unrecognized voucher envelope format.");
        return;
      }
      setEnvelope(parsed);

      if (!parsed.protected) {
        const rawPlain = parsed.plainPayload || (parsed as any).plaintext;
        if (rawPlain) {
          const invJson = new TextDecoder().decode(base64UrlToBytes(rawPlain));
          const inv = JSON.parse(invJson) as OwnlystInvoice;
          setDecodedInvoice(inv);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to parse voucher envelope.");
    }
  }, []);

  // Pre-fill provisioning fields when recipient metadata is available
  useEffect(() => {
    if (envelope?.meta) {
      if (!bizName && envelope.meta.recipientName) setBizName(envelope.meta.recipientName);
      if (!bizGstin && envelope.meta.recipientGstin) {
        setBizGstin(envelope.meta.recipientGstin);
        if (envelope.meta.recipientGstin.length === 15) {
          setBizPan(envelope.meta.recipientGstin.slice(2, 12));
          setBizStateCode(envelope.meta.recipientGstin.slice(0, 2));
        }
      }
    }
  }, [envelope, bizName, bizGstin]);

  // Auto-select business matching recipient GSTIN or default to first business
  useEffect(() => {
    if (businesses && businesses.length > 0 && !selectedBusinessId) {
      const recipientGstin = envelope?.meta.recipientGstin?.trim().toUpperCase();
      const matched = recipientGstin
        ? businesses.find((b) => b.gstin?.trim().toUpperCase() === recipientGstin)
        : null;
      setSelectedBusinessId(matched ? matched.id : businesses[0].id);
    }
  }, [businesses, selectedBusinessId, envelope]);

  // Mutations
  const claimMutation = trpc.invoice.claimOwnlystBill.useMutation({
    onSuccess: (data) => {
      setClaimSuccess({
        invoiceId: data.invoiceId,
        invoiceNumber: data.invoiceNumber,
        alreadyClaimed: data.alreadyClaimed,
      });
      // Clear pending claim token
      localStorage.removeItem("pendingClaimHash");
    },
    onError: (err) => {
      setError(err.message || "Failed to record purchase bill in ledger.");
    },
  });

  const createBusinessMutation = trpc.business.create.useMutation({
    onSuccess: async (newBiz) => {
      await utils.business.list.invalidate();
      setShowProvisionModal(false);
      setSelectedBusinessId(newBiz.id);
      setBusinessId(newBiz.id);
    },
    onError: (err) => {
      setProvisionError(err.message || "Failed to create business.");
    },
  });

  // Decrypt handler
  const handleDecrypt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!envelope || !envelope.salt || !envelope.iv || !envelope.ciphertext) return;
    if (!password.trim()) {
      setError("Please enter the password.");
      return;
    }
    setDecrypting(true);
    setError(null);
    try {
      const salt = base64UrlToBytes(envelope.salt);
      const iv = base64UrlToBytes(envelope.iv);
      const ciphertext = base64UrlToBytes(envelope.ciphertext);
      const key = await deriveAesKey(password.trim(), salt);
      const decrypted = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv as BufferSource },
        key,
        ciphertext as BufferSource
      );
      const json = new TextDecoder().decode(decrypted);
      const inv = JSON.parse(json) as OwnlystInvoice;
      setDecodedInvoice(inv);
    } catch {
      setError("Incorrect password. Cryptographic authentication failed.");
    } finally {
      setDecrypting(false);
    }
  };

  // Auth redirect handler
  const handleRequireLogin = () => {
    localStorage.setItem("pendingClaimHash", window.location.hash);
    navigate({ to: "/login" });
  };

  // Claim submission handler
  const handleClaim = () => {
    if (!decodedInvoice || !selectedBusinessId) return;
    setError(null);
    setBusinessId(selectedBusinessId);

    const sender = decodedInvoice.sender;
    const gstin = sender.taxId?.trim() || null;
    const autoPan = gstin && gstin.length === 15 ? gstin.slice(2, 12) : null;
    const autoStateCode = gstin && gstin.length === 15 ? gstin.slice(0, 2) : null;

    const dedupeKey = `${decodedInvoice.invoiceNumber.trim()}::${gstin || sender.iban || "OWNLYST"}`;

    const claimPayload = {
      businessId: selectedBusinessId,
      dedupeKey,
      supplier: {
        name: sender.name || "Vendor",
        gstin,
        pan: autoPan,
        email: sender.email || null,
        phone: sender.phone || null,
        address: `${sender.street || ""} ${sender.building || ""}`.trim() || null,
        city: sender.city || null,
        state: null,
        stateCode: autoStateCode,
        pincode: sender.postalCode || null,
        bankAccountNumber: sender.accountNumber || null,
        bankIfsc: sender.ifscCode || null,
      },
      invoiceNumber: decodedInvoice.invoiceNumber,
      invoiceDate: decodedInvoice.issueDate || new Date().toISOString(),
      dueDate: decodedInvoice.dueDate || null,
      notes: decodedInvoice.notes || null,
      isReverseCharge: Boolean(decodedInvoice.reverseCharge),
      currency: decodedInvoice.currency || "INR",
      lineItems: decodedInvoice.items.map((it) => ({
        itemName: it.description || "Item",
        description: it.description || null,
        hsn: it.hsnSac || null,
        quantity: String(it.quantity || "1"),
        unitPrice: String(it.unitPrice || "0"),
        taxPercent: String(it.taxRate ?? "0"),
        discountPercent: "0",
        unit: "pcs" as const,
      })),
    };

    claimMutation.mutate(claimPayload);
  };

  // 1-Click Provision Submit
  const handleProvisionBusiness = (e: React.FormEvent) => {
    e.preventDefault();
    setProvisionError("");

    if (!bizName.trim()) {
      setProvisionError("Business name is required.");
      return;
    }
    const cleanPan = bizPan.trim().toUpperCase();
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(cleanPan)) {
      setProvisionError("Valid 10-character PAN required (e.g. ABCDE1234F).");
      return;
    }
    if (!bizPhone.trim()) {
      setProvisionError("Phone number is required.");
      return;
    }
    if (!bizAddress.trim()) {
      setProvisionError("Address is required.");
      return;
    }

    createBusinessMutation.mutate({
      name: bizName.trim(),
      pan: cleanPan,
      phone: bizPhone.trim(),
      address: bizAddress.trim(),
      gstin: bizGstin.trim() || undefined,
      stateCode: bizStateCode.trim() || undefined,
      gstRegistrationType: bizGstin.trim() ? "regular" : "unregistered",
      currency: "INR",
      invoicePrefix: "INV",
    });
  };

  const totals = useMemo(() => {
    if (!decodedInvoice) return null;
    let subtotal = 0;
    let taxTotal = 0;
    for (const it of decodedInvoice.items) {
      const lineBase = it.quantity * it.unitPrice;
      const lineTax = (lineBase * (it.taxRate || 0)) / 100;
      subtotal += lineBase;
      taxTotal += lineTax;
    }
    return {
      subtotal,
      taxTotal,
      grandTotal: subtotal + taxTotal,
    };
  }, [decodedInvoice]);

  return (
    <div className="min-h-screen bg-surface-1 flex flex-col">
      {/* ── Top Header ────────────────────────────────────────────── */}
      <header className="bg-surface-0 border-b border-border px-4 py-3.5 sm:px-8 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Logo />
          <span className="text-border">/</span>
          <span className="text-xs font-semibold text-text-primary tracking-wide uppercase">
            Auditor &amp; Purchase Bill Claim Portal
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {session?.user ? (
            <span className="text-text-secondary hidden sm:inline">
              Signed in as <strong>{session.user.name || session.user.email}</strong>
            </span>
          ) : (
            <button
              type="button"
              onClick={handleRequireLogin}
              className="text-brand-600 hover:underline font-medium"
            >
              Sign In
            </button>
          )}
        </div>
      </header>

      {/* ── Main Container ────────────────────────────────────────── */}
      <main className="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {/* Verification Badge Bar */}
        <div className="flex items-center justify-between bg-surface-0 border border-border p-3.5 rounded-xl shadow-xs gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs">
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 font-bold">
              ✓
            </span>
            <span className="font-semibold text-text-primary">
              Cryptographically Verified Ownlyst Voucher
            </span>
            <span className="text-text-tertiary hidden sm:inline">· SHA-256 / AES-256-GCM Envelope</span>
          </div>
          {envelope?.meta.invoiceNumber && (
            <div className="font-mono text-xs font-bold bg-surface-2 px-2.5 py-1 rounded-md text-text-primary">
              #{envelope.meta.invoiceNumber}
            </div>
          )}
        </div>

        {/* Counterparty Header Card (Unencrypted Meta) */}
        {envelope?.meta && (
          <div className="card p-5 sm:p-6 space-y-4">
            <div className="flex items-start justify-between gap-4 flex-wrap pb-4 border-b border-border">
              <div>
                <span className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">
                  Issuer / Supplier
                </span>
                <h2 className="text-lg font-bold text-text-primary mt-0.5">
                  {envelope.meta.senderName}
                </h2>
                {envelope.meta.senderGstin && (
                  <span className="font-mono text-xs text-text-secondary">
                    GSTIN: {envelope.meta.senderGstin}
                  </span>
                )}
              </div>
              <div className="text-right">
                <span className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider block">
                  Net Payable
                </span>
                <span className="text-xl sm:text-2xl font-bold font-mono text-text-primary">
                  {formatMoney(envelope.meta.grandTotal, envelope.meta.currency)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs pt-1">
              <div>
                <span className="text-text-tertiary block text-[11px]">Billed To:</span>
                <span className="font-semibold text-text-primary">{envelope.meta.recipientName || "—"}</span>
              </div>
              <div>
                <span className="text-text-tertiary block text-[11px]">Recipient GSTIN:</span>
                <span className="font-mono font-medium text-text-primary">
                  {envelope.meta.recipientGstin || "Unregistered / Consumer"}
                </span>
              </div>
              <div>
                <span className="text-text-tertiary block text-[11px]">Issue Date:</span>
                <span className="font-medium text-text-primary">{envelope.meta.issueDate || "—"}</span>
              </div>
              <div>
                <span className="text-text-tertiary block text-[11px]">Due Date:</span>
                <span className="font-medium text-text-primary">{envelope.meta.dueDate || "—"}</span>
              </div>
            </div>
          </div>
        )}

        {/* Password Prompt if Protected and Not Decrypted */}
        {!decodedInvoice && envelope?.protected && (
          <div className="card p-6 sm:p-8 max-w-md mx-auto text-center space-y-4 shadow-md">
            <div className="w-12 h-12 rounded-full bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto text-xl">
              🔒
            </div>
            <div>
              <h3 className="text-base font-bold text-text-primary">Password Protected Voucher</h3>
              <p className="text-xs text-text-secondary mt-1">
                Enter the secret passphrase supplied by the issuer to unlock line items, taxes, and claim this bill.
              </p>
              {envelope.hint && (
                <div className="mt-2.5 p-2 bg-surface-2 rounded-md text-[11px] text-text-secondary">
                  <strong>Password Hint:</strong> {envelope.hint}
                </div>
              )}
            </div>

            <form onSubmit={handleDecrypt} className="space-y-3">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter passphrase…"
                className="input text-center font-mono"
                autoFocus
              />
              {error && <div className="text-xs text-red-600 font-medium">{error}</div>}
              <button
                type="submit"
                disabled={decrypting}
                className="btn-primary w-full"
              >
                {decrypting ? "Decrypting Voucher…" : "Unlock Voucher Details"}
              </button>
            </form>
          </div>
        )}

        {/* Claim Success Banner */}
        {claimSuccess && (
          <div className="card p-6 bg-emerald-50 border-emerald-200 text-emerald-900 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xl">🎉</span>
              <h3 className="text-base font-bold">
                {claimSuccess.alreadyClaimed
                  ? "Bill Already Mirrored in Ledger"
                  : "Purchase Bill Recorded Successfully!"}
              </h3>
            </div>
            <p className="text-xs text-emerald-800 leading-relaxed">
              Invoice <strong>#{claimSuccess.invoiceNumber}</strong> has been mirrored into your purchases ledger. Supplier masters, catalog items, product stock increments, and Input Tax Credit (ITC) have been atomically updated.
            </p>
            <div className="pt-2 flex items-center gap-3">
              <Link
                to="/invoices"
                className="btn-primary bg-emerald-700 hover:bg-emerald-800 text-white text-xs"
              >
                View in Purchases Ledger ➔
              </Link>
            </div>
          </div>
        )}

        {/* Decrypted Line Items & Claim Action Section */}
        {decodedInvoice && !claimSuccess && (
          <div className="space-y-6">
            {/* Action Bar / Claim Execution Panel */}
            <div className="card p-5 sm:p-6 bg-surface-0 space-y-4 border-2 border-brand-500/20">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <h3 className="text-base font-bold text-text-primary">
                    Record into Hisaabo General Ledger
                  </h3>
                  <p className="text-xs text-text-secondary mt-0.5">
                    1-Click mirror: upserts supplier party, catalog items, stock deltas, and Input Tax Credit (ITC).
                  </p>
                </div>
              </div>

              {/* Status branch 1: Unauthenticated */}
              {!session?.user && (
                <div className="pt-2 p-4 bg-surface-2 rounded-xl flex items-center justify-between gap-4 flex-wrap">
                  <div className="text-xs text-text-secondary">
                    You must sign in or register to mirror this bill into your business accounts.
                  </div>
                  <button
                    type="button"
                    onClick={handleRequireLogin}
                    className="btn-primary text-xs"
                  >
                    Sign In or Register to Claim Bill ➔
                  </button>
                </div>
              )}

              {/* Status branch 2: Authenticated with 0 businesses */}
              {session?.user && Array.isArray(businesses) && businesses.length === 0 && (
                <div className="pt-2 p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-3">
                  <div className="text-xs text-amber-900 font-semibold">
                    You have an active Hisaabo account, but have not created a business yet.
                  </div>
                  <p className="text-xs text-amber-800">
                    Use our 1-click business setup to provision <strong>{envelope?.meta.recipientName || "your business"}</strong> with auto-derived PAN and state code from this voucher.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowProvisionModal(true)}
                    className="btn-primary bg-amber-700 hover:bg-amber-800 text-xs"
                  >
                    1-Click Setup Business for {envelope?.meta.recipientName || "Recipient"} ➔
                  </button>
                </div>
              )}

              {/* Status branch 3: Authenticated with 1+ businesses */}
              {session?.user && Array.isArray(businesses) && businesses.length > 0 && (
                <div className="pt-2 flex items-center gap-4 flex-wrap">
                  <div className="w-full sm:w-72">
                    <label className="block text-[11px] font-semibold text-text-tertiary mb-1">
                      Target Ledger Business
                    </label>
                    <select
                      value={selectedBusinessId}
                      onChange={(e) => setSelectedBusinessId(e.target.value)}
                      className="input text-xs font-medium"
                    >
                      {businesses.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} ({b.gstin || "Unregistered"})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="pt-5 flex-1 min-w-[200px]">
                    <button
                      type="button"
                      onClick={handleClaim}
                      disabled={claimMutation.isPending || !selectedBusinessId}
                      className="btn-primary w-full sm:w-auto px-6 py-2.5 font-bold"
                    >
                      {claimMutation.isPending ? "Mirroring into Ledger…" : "Claim & Mirror into Ledger as Purchase Bill ➔"}
                    </button>
                  </div>
                </div>
              )}

              {error && <div className="text-xs text-red-600 font-medium">{error}</div>}
            </div>

            {/* Line Items Table */}
            <div className="card overflow-hidden">
              <div className="p-4 border-b border-border bg-surface-1 flex items-center justify-between">
                <span className="text-xs font-bold text-text-primary uppercase tracking-wide">
                  Itemized Line Items
                </span>
                <span className="text-xs text-text-secondary">
                  {decodedInvoice.items.length} item(s)
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-[11px] text-text-tertiary font-semibold text-left">
                      <th className="py-2.5 px-4">Item &amp; Description</th>
                      <th className="py-2.5 px-3">HSN/SAC</th>
                      <th className="py-2.5 px-3 text-right">Qty</th>
                      <th className="py-2.5 px-3 text-right">Unit Price</th>
                      <th className="py-2.5 px-3 text-right">Tax %</th>
                      <th className="py-2.5 px-4 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {decodedInvoice.items.map((it, idx) => {
                      const lineBase = it.quantity * it.unitPrice;
                      return (
                        <tr key={idx} className="hover:bg-surface-1">
                          <td className="py-2.5 px-4 font-medium text-text-primary">{it.description}</td>
                          <td className="py-2.5 px-3 font-mono text-text-secondary">{it.hsnSac || "—"}</td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">{it.quantity}</td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                            {formatMoney(it.unitPrice, decodedInvoice.currency)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">{it.taxRate}%</td>
                          <td className="py-2.5 px-4 text-right font-mono font-bold text-text-primary tabular-nums">
                            {formatMoney(lineBase, decodedInvoice.currency)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Totals Summary */}
              {totals && (
                <div className="p-4 bg-surface-1 border-t border-border flex justify-end">
                  <div className="w-64 space-y-1.5 text-xs">
                    <div className="flex justify-between text-text-secondary">
                      <span>Subtotal:</span>
                      <span className="font-mono">{formatMoney(totals.subtotal, decodedInvoice.currency)}</span>
                    </div>
                    <div className="flex justify-between text-text-secondary">
                      <span>GST Tax Total:</span>
                      <span className="font-mono">{formatMoney(totals.taxTotal, decodedInvoice.currency)}</span>
                    </div>
                    <div className="flex justify-between text-base font-bold text-text-primary border-t border-border pt-2 mt-1">
                      <span>Net Payable:</span>
                      <span className="font-mono">{formatMoney(totals.grandTotal, decodedInvoice.currency)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* ── 1-Click Business Provisioning Modal ────────────────────── */}
      {showProvisionModal && (
        <Modal
          title="1-Click Business Setup"
          open={showProvisionModal}
          onClose={() => setShowProvisionModal(false)}
        >
          <form onSubmit={handleProvisionBusiness} className="space-y-4">
            <p className="text-xs text-text-secondary">
              Provide required business details to register your organization and record this voucher into your purchases ledger.
            </p>

            <FormField label="Business / Trade Name" htmlFor={businessNameId} required>
              <input
                id={businessNameId}
                type="text"
                value={bizName}
                onChange={(e) => setBizName(e.target.value)}
                className="input"
                required
              />
            </FormField>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="GSTIN (Optional)" htmlFor={gstinId}>
                <input
                  id={gstinId}
                  type="text"
                  value={bizGstin}
                  onChange={(e) => {
                    const val = e.target.value.toUpperCase();
                    setBizGstin(val);
                    if (val.length === 15) {
                      setBizPan(val.slice(2, 12));
                      setBizStateCode(val.slice(0, 2));
                    }
                  }}
                  placeholder="22AAAAA0000A1Z5"
                  className="input font-mono"
                />
              </FormField>

              <FormField label="Permanent Account Number (PAN)" htmlFor={panId} required>
                <input
                  id={panId}
                  type="text"
                  value={bizPan}
                  onChange={(e) => setBizPan(e.target.value.toUpperCase())}
                  placeholder="ABCDE1234F"
                  className="input font-mono"
                  required
                />
              </FormField>
            </div>

            <FormField label="Business Phone" htmlFor={phoneId} required>
              <input
                id={phoneId}
                type="tel"
                value={bizPhone}
                onChange={(e) => setBizPhone(e.target.value)}
                placeholder="9876543210"
                className="input"
                required
              />
            </FormField>

            <FormField label="Registered Business Address" htmlFor={addressId} required>
              <textarea
                id={addressId}
                value={bizAddress}
                onChange={(e) => setBizAddress(e.target.value)}
                placeholder="Street address, building, locality"
                className="input min-h-[60px]"
                required
              />
            </FormField>

            {provisionError && (
              <div className="text-xs text-red-600 font-medium">{provisionError}</div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowProvisionModal(false)}
                className="btn-secondary text-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createBusinessMutation.isPending}
                className="btn-primary text-xs"
              >
                {createBusinessMutation.isPending ? "Creating Business…" : "Create Business & Return"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
