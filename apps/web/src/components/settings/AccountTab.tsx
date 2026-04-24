import { useState, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { PillTabs } from "@/components/ui/Tabs";
import { toast } from "@/hooks/useToast";
import { cn, todayISODate } from "@/lib/utils";
import dayjs from "dayjs";
import { parseUserAgent } from "@/lib/parse-user-agent";
import { useInfiniteList } from "@/hooks/useInfiniteList";

// ── Action label map ──────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  "invoice.create": "Invoice created",
  "invoice.update": "Invoice updated",
  "invoice.updateStatus": "Invoice status changed",
  "invoice.delete": "Invoice deleted",
  "payment.create": "Payment recorded",
  "payment.update": "Payment updated",
  "payment.delete": "Payment deleted",
  "payment.reassignBankAccount": "Payment bank account changed",
  "party.create": "Party created",
  "party.update": "Party updated",
  "party.delete": "Party deleted",
  "party.merge": "Parties merged",
  "item.create": "Item created",
  "item.update": "Item updated",
  "item.delete": "Item deleted",
  "item.switchBaseUnit": "Item unit converted",
  "item.renameUnit": "Item unit renamed",
  "item.createVariant": "Item variant created",
  "item.updateVariant": "Item variant updated",
  "item.deleteVariant": "Item variant deleted",
  "expense.create": "Expense recorded",
  "expense.update": "Expense updated",
  "expense.delete": "Expense deleted",
  "bankAccount.create": "Bank account added",
  "bankAccount.update": "Bank account updated",
  "bankAccount.delete": "Bank account deleted",
  "bankTransaction.create": "Bank transaction recorded",
  "bankTransaction.transfer": "Bank transfer made",
  "business.create": "Business created",
  "business.update": "Business updated",
  "business.updateSequenceNumber": "Sequence number updated",
  "quotation.create": "Quotation created",
  "quotation.updateStatus": "Quotation status changed",
  "quotation.delete": "Quotation deleted",
  "credit_note.create": "Credit note created",
  "credit_note.updateStatus": "Credit note status changed",
  "credit_note.delete": "Credit note deleted",
  "debit_note.create": "Debit note created",
  "debit_note.updateStatus": "Debit note status changed",
  "debit_note.delete": "Debit note deleted",
  "delivery_challan.create": "Delivery challan created",
  "delivery_challan.updateStatus": "Delivery challan status changed",
  "delivery_challan.delete": "Delivery challan deleted",
  "proforma.create": "Proforma invoice created",
  "proforma.updateStatus": "Proforma status changed",
  "proforma.delete": "Proforma invoice deleted",
  "sales_return.create": "Sales return created",
  "sales_return.updateStatus": "Sales return status changed",
  "sales_return.delete": "Sales return deleted",
  "purchase_return.create": "Purchase return created",
  "purchase_return.updateStatus": "Purchase return status changed",
  "purchase_return.delete": "Purchase return deleted",
  "document.convert": "Document converted",
  "recurringInvoice.create": "Recurring invoice created",
  "recurringInvoice.update": "Recurring invoice updated",
  "recurringInvoice.pause": "Recurring invoice paused",
  "recurringInvoice.resume": "Recurring invoice resumed",
  "recurringInvoice.delete": "Recurring invoice deleted",
  "shipment.create": "Shipment created",
  "shipment.update": "Shipment updated",
  "shipment.delete": "Shipment deleted",
  "salesTarget.create": "Sales target set",
  "salesTarget.update": "Sales target updated",
  "salesTarget.delete": "Sales target removed",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

export function timeAgo(date: Date | string | null): string {
  if (!date) return "Unknown";
  const now = Date.now();
  const then = new Date(date).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Active now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(date).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ── Device icon SVGs ──────────────────────────────────────────────────────────

function MonitorIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2" /><path d="M12 18h.01" />
    </svg>
  );
}

function TabletIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="2" /><path d="M12 18h.01" />
    </svg>
  );
}

function DeviceIcon({ type }: { type: "desktop" | "mobile" | "tablet" }) {
  if (type === "mobile") return <PhoneIcon />;
  if (type === "tablet") return <TabletIcon />;
  return <MonitorIcon />;
}

// ── Profile Section ───────────────────────────────────────────────────────────

function ProfileCard() {
  const { data: session } = trpc.auth.me.useQuery();
  const utils = trpc.useUtils();

  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState(session?.user?.name || "");
  const [changingEmail, setChangingEmail] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);

  const updateNameMut = trpc.auth.updateName.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
      setEditingName(false);
      toast.success("Name updated");
    },
    onError: (err) => toast.error("Failed", err.message),
  });

  const changeEmailMut = trpc.auth.requestEmailChange.useMutation({
    onSuccess: () => setEmailSent(true),
    onError: (err) => toast.error("Failed", err.message),
  });

  return (
    <div className="card px-6 py-5">
      <h3 className="text-sm font-semibold text-text-primary mb-4">Your Profile</h3>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-xs text-text-tertiary">Name</span>
          {editingName ? (
            <div className="flex items-center gap-2 mt-1">
              <input
                className="input py-1 text-sm"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
              />
              <button
                className="btn-primary btn-sm"
                onClick={() => updateNameMut.mutate({ name: newName })}
                disabled={updateNameMut.isPending}
              >
                Save
              </button>
              <button className="btn-ghost btn-sm" onClick={() => setEditingName(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <p className="text-text-primary">{session?.user?.name || "—"}</p>
              <button
                className="text-xs text-brand-600 hover:text-brand-700"
                onClick={() => {
                  setNewName(session?.user?.name || "");
                  setEditingName(true);
                }}
              >
                Edit
              </button>
            </div>
          )}
        </div>
        <div>
          <span className="text-xs text-text-tertiary">Email</span>
          <p className="text-text-primary">{session?.user?.email || "—"}</p>
          {!changingEmail && !emailSent && (
            <button
              className="text-xs text-brand-600 hover:text-brand-700 mt-1"
              onClick={() => { setChangingEmail(true); setNewEmail(""); }}
            >
              Change Email
            </button>
          )}
          {changingEmail && !emailSent && (
            <div className="flex items-center gap-2 mt-1">
              <input
                type="email"
                className="input py-1 text-sm"
                placeholder="New email address"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                autoFocus
              />
              <button
                className="btn-primary btn-sm"
                onClick={() => changeEmailMut.mutate({ newEmail })}
                disabled={changeEmailMut.isPending || !newEmail}
              >
                Send verification
              </button>
              <button className="btn-ghost btn-sm" onClick={() => setChangingEmail(false)}>
                Cancel
              </button>
            </div>
          )}
          {emailSent && (
            <p className="text-xs text-green-600 mt-1">
              Verification email sent to {newEmail}. Check your inbox to confirm the change.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sessions Section ──────────────────────────────────────────────────────────

const SESSION_FILTERS = [
  { value: "active", label: "Active" },
  { value: "old", label: "Old" },
];

function SessionsContent() {
  const [filter, setFilter] = useState("active");
  const isExpired = filter === "old";
  const { data: sessionsList, isLoading } = trpc.auth.listSessions.useQuery({ expired: isExpired });
  const utils = trpc.useUtils();
  const [showRevokeAll, setShowRevokeAll] = useState(false);

  const revokeMutation = trpc.auth.revokeSession.useMutation({
    onSuccess: () => {
      utils.auth.listSessions.invalidate();
      toast.success("Session revoked");
    },
    onError: (err) => toast.error("Failed to revoke session", err.message),
  });

  const logoutAllMutation = trpc.auth.logoutAll.useMutation({
    onSuccess: () => {
      toast.info("Signed out from all other devices");
      utils.auth.me.invalidate();
      window.location.href = "/login";
    },
    onError: (err) => toast.error("Failed", err.message),
  });

  const otherActiveSessions = sessionsList?.filter((s) => !s.isCurrent) ?? [];

  return (
    <>
      <div className="card overflow-hidden">
        <div className="px-6 py-3 flex items-center justify-between border-b border-border-light">
          <PillTabs tabs={SESSION_FILTERS} value={filter} onChange={setFilter} size="sm" />
          {!isExpired && otherActiveSessions.length > 0 && (
            <button
              className="btn-ghost text-xs text-red-600 hover:text-red-700"
              onClick={() => setShowRevokeAll(true)}
            >
              Sign out all others
            </button>
          )}
        </div>

        <div className="max-h-[400px] overflow-y-auto">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="skeleton h-16 rounded-lg" />
              ))}
            </div>
          ) : !sessionsList?.length ? (
            <p className="text-sm text-text-tertiary py-8 text-center">
              {isExpired ? "No expired sessions." : "No active sessions."}
            </p>
          ) : (
            <div className="p-4 space-y-2">
              {sessionsList.map((session) => {
                const ua = parseUserAgent(session.userAgent);
                return (
                  <div
                    key={session.id}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 rounded-lg border",
                      session.isCurrent
                        ? "border-brand-600/20 bg-brand-600/[0.03]"
                        : isExpired
                          ? "border-border-light bg-surface-1 opacity-60"
                          : "border-border-light bg-surface-0",
                    )}
                  >
                    <div className="w-9 h-9 rounded-lg bg-surface-2 flex items-center justify-center text-text-secondary shrink-0">
                      <DeviceIcon type={ua.deviceType} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text-primary truncate">
                          {ua.browser} on {ua.os}
                        </span>
                        {session.isCurrent && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-600/[0.08] text-emerald-700 dark:text-emerald-400 shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            This device
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-text-tertiary mt-0.5">
                        {session.ipAddress && <span>{session.ipAddress}</span>}
                        {session.ipAddress && <span>·</span>}
                        <span>{isExpired ? `Expired ${timeAgo(session.expiresAt)}` : timeAgo(session.lastUsedAt ?? session.createdAt)}</span>
                      </div>
                    </div>

                    {!session.isCurrent && !isExpired && (
                      <button
                        onClick={() => revokeMutation.mutate({ sessionId: session.id })}
                        disabled={revokeMutation.isPending}
                        className="btn-ghost text-xs text-red-600 hover:text-red-700 shrink-0"
                      >
                        Sign out
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={showRevokeAll}
        title="Sign out from all other devices?"
        description="This will end all your other sessions. You'll stay signed in on this device."
        confirmLabel="Sign out all others"
        variant="danger"
        loading={logoutAllMutation.isPending}
        onConfirm={() => logoutAllMutation.mutate()}
        onCancel={() => setShowRevokeAll(false)}
      />
    </>
  );
}

// ── Activity Log Section ──────────────────────────────────────────────────────

const AUDIT_FILTERS = [
  { value: "this-week", label: "This Week" },
  { value: "this-month", label: "This Month" },
  { value: "all", label: "All Time" },
];

function getDateRange(filter: string): { fromDate?: string; toDate?: string } {
  const now = dayjs();
  if (filter === "this-week") {
    return {
      fromDate: now.subtract(7, "day").startOf("day").toISOString(),
      toDate: now.toISOString(),
    };
  }
  if (filter === "this-month") {
    return {
      fromDate: now.startOf("month").toISOString(),
      toDate: now.toISOString(),
    };
  }
  return {};
}

const AUDIT_PAGE_SIZE = 30;

function ActivityLogContent() {
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const dateRange = getDateRange(filter);

  const { data, isFetching } = trpc.business.auditTrail.useQuery(
    { page, limit: AUDIT_PAGE_SIZE, fromDate: dateRange.fromDate, toDate: dateRange.toDate },
    { placeholderData: (prev: any) => prev },
  );

  const loadMore = useCallback(() => setPage((p) => p + 1), []);

  const list = useInfiniteList({
    key: "audit-log",
    data: data?.data,
    total: data?.total ?? 0,
    page,
    isFetching,
    onLoadMore: loadMore,
    resetDeps: [filter],
  });

  // Reset page when filter changes
  useEffect(() => setPage(1), [filter]);

  return (
    <div className="card overflow-hidden">
      <div className="px-6 py-3 border-b border-border-light">
        <PillTabs tabs={AUDIT_FILTERS} value={filter} onChange={setFilter} size="sm" />
      </div>

      <div
        ref={list.scrollRef}
        onScroll={list.onScroll}
        className="max-h-[400px] overflow-y-auto"
      >
        {isFetching && list.items.length === 0 ? (
          <div className="p-6 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="skeleton h-10 rounded" />
            ))}
          </div>
        ) : list.items.length === 0 ? (
          <p className="text-sm text-text-tertiary py-8 text-center">
            No activity recorded{filter !== "all" ? " in this period" : " yet"}.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {list.items.map((entry: any) => {
              let meta: Record<string, unknown> = {};
              try {
                if (entry.metadata) meta = JSON.parse(entry.metadata);
              } catch { /* ignore */ }

              const label = ACTION_LABELS[entry.action] ?? entry.action;
              const detail =
                (meta.invoiceNumber as string) ||
                (meta.paymentNumber as string) ||
                (meta.name as string) ||
                (meta.accountName as string) ||
                (meta.sourceName ? `${meta.sourceName} → ${meta.targetName}` : null) ||
                null;

              return (
                <div key={entry.id} className="px-6 py-3 flex items-start justify-between gap-4 text-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-text-primary font-medium">{label}</span>
                      {detail && (
                        <span className="text-text-tertiary">{detail}</span>
                      )}
                    </div>
                    <span className="text-xs text-text-tertiary mt-0.5 block">
                      by {entry.userName ?? "Unknown"}
                    </span>
                  </div>
                  <span className="text-xs text-text-tertiary whitespace-nowrap shrink-0">
                    {timeAgo(entry.createdAt)}
                  </span>
                </div>
              );
            })}
            {list.loadingMore && (
              <div className="px-6 py-3 text-center">
                <div className="skeleton h-8 rounded w-32 mx-auto" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── API Keys Section ─────────────────────────────────────────────────────────

function KeyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

function ApiKeysContent() {
  const { data: session } = trpc.auth.me.useQuery();
  const { data: tenantList } = trpc.tenant.list.useQuery();
  const { data: keys, isLoading } = trpc.apiKey.list.useQuery();
  const utils = trpc.useUtils();

  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyExpiry, setNewKeyExpiry] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const currentTenant = tenantList?.find((t) => t.tenantId === session?.tenantId);
  const isFree = currentTenant?.tenantPlan === "free";

  const createMutation = trpc.apiKey.create.useMutation({
    onSuccess: (data) => {
      setCreatedKey(data.key);
      utils.apiKey.list.invalidate();
    },
    onError: (err) => toast.error("Failed to create API key", err.message),
  });

  const revokeMutation = trpc.apiKey.revoke.useMutation({
    onSuccess: () => {
      utils.apiKey.list.invalidate();
      toast.success("API key revoked");
    },
    onError: (err) => toast.error("Failed to revoke", err.message),
  });

  function handleCreate() {
    if (!newKeyName.trim()) return;
    createMutation.mutate({
      name: newKeyName.trim(),
      expiresAt: newKeyExpiry || undefined,
    });
  }

  function handleCloseCreateModal() {
    setShowCreate(false);
    setNewKeyName("");
    setNewKeyExpiry("");
    setCreatedKey(null);
    setCopied(false);
  }

  function handleCopy() {
    if (createdKey) {
      navigator.clipboard.writeText(createdKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <>
      <div className="card overflow-hidden">
        <div className="px-6 py-3 flex items-center justify-between border-b border-border-light">
          <span className="text-sm font-medium text-text-primary">API Keys</span>
          {!isFree && (
            <button
              className="btn-primary btn-sm"
              onClick={() => setShowCreate(true)}
            >
              + Create API Key
            </button>
          )}
        </div>

        <div className="max-h-[400px] overflow-y-auto">
          {isFree ? (
            <p className="text-sm text-text-tertiary py-8 text-center px-6">
              API keys are available on paid plans. Upgrade to create programmatic access tokens.
            </p>
          ) : isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="skeleton h-16 rounded-lg" />
              ))}
            </div>
          ) : !keys?.length ? (
            <p className="text-sm text-text-tertiary py-8 text-center">
              No API keys created yet.
            </p>
          ) : (
            <div className="p-4 space-y-2">
              {keys.map((k) => (
                <div
                  key={k.id}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border-light bg-surface-0"
                >
                  <div className="w-9 h-9 rounded-lg bg-surface-2 flex items-center justify-center text-text-secondary shrink-0">
                    <KeyIcon />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-primary truncate">
                        {k.name}
                      </span>
                      <span className="text-xs font-mono text-text-tertiary truncate">
                        {k.keyPrefix}...
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-text-tertiary mt-0.5">
                      <span>
                        {k.lastUsedAt ? `Last used ${timeAgo(k.lastUsedAt)}` : "Never used"}
                      </span>
                      <span>&middot;</span>
                      <span>
                        {k.expiresAt
                          ? `Expires ${new Date(k.expiresAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`
                          : "Never expires"}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => setRevokeTarget({ id: k.id, name: k.name })}
                    className="btn-ghost text-xs text-red-600 hover:text-red-700 shrink-0"
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create API Key Modal */}
      <Modal
        open={showCreate}
        onClose={handleCloseCreateModal}
        title={createdKey ? "API Key Created" : "Create API Key"}
      >
        {createdKey ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-600/40 dark:bg-amber-900/20 px-4 py-3">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                Copy this key now — it won't be shown again.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm font-mono bg-surface-2 rounded-lg px-3 py-2 text-text-primary break-all select-all">
                {createdKey}
              </code>
              <button
                className="btn-primary btn-sm shrink-0"
                onClick={handleCopy}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <div className="flex justify-end">
              <button className="btn-primary" onClick={handleCloseCreateModal}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-text-primary block mb-1">
                Key Name <span className="text-red-500">*</span>
              </label>
              <input
                className="input w-full"
                placeholder="e.g. CLI Access Key"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="text-sm font-medium text-text-primary block mb-1">
                Expiry Date <span className="text-text-tertiary text-xs">(optional)</span>
              </label>
              <input
                type="date"
                className="input w-full"
                value={newKeyExpiry}
                onChange={(e) => setNewKeyExpiry(e.target.value)}
                min={todayISODate()}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-ghost" onClick={handleCloseCreateModal}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={handleCreate}
                disabled={!newKeyName.trim() || createMutation.isPending}
              >
                {createMutation.isPending ? "Creating..." : "Create Key"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Revoke Confirmation */}
      <ConfirmDialog
        open={!!revokeTarget}
        title="Revoke API key?"
        description={`This will permanently revoke "${revokeTarget?.name ?? ""}". Any integrations using this key will stop working immediately.`}
        confirmLabel="Revoke"
        variant="danger"
        loading={revokeMutation.isPending}
        onConfirm={() => {
          if (revokeTarget) {
            revokeMutation.mutate({ id: revokeTarget.id });
            setRevokeTarget(null);
          }
        }}
        onCancel={() => setRevokeTarget(null)}
      />
    </>
  );
}

// ── Main Export ────────────────────────────────────────────────────────────────

const ACCOUNT_TABS = [
  { value: "sessions", label: "Sessions" },
  { value: "api-keys", label: "API Keys" },
  { value: "activity", label: "Activity Log" },
];

export function AccountTab() {
  const [tab, setTab] = useState("sessions");

  return (
    <div className="space-y-6">
      <ProfileCard />
      <div>
        <PillTabs tabs={ACCOUNT_TABS} value={tab} onChange={setTab} className="mb-4" />
        {tab === "sessions" && <SessionsContent />}
        {tab === "api-keys" && <ApiKeysContent />}
        {tab === "activity" && <ActivityLogContent />}
      </div>
    </div>
  );
}
