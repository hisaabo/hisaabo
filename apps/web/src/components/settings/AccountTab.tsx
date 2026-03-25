import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { toast } from "@/hooks/useToast";

const ACTION_LABELS: Record<string, string> = {
  "invoice.create": "Invoice created",
  "invoice.delete": "Invoice deleted",
  "payment.create": "Payment recorded",
  "payment.delete": "Payment deleted",
  "party.merge": "Parties merged",
};

function formatDate(date: Date | string) {
  return new Date(date).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AuditTrailCard() {
  const [page, setPage] = useState(1);
  const limit = 20;
  const { data, isLoading } = trpc.business.auditTrail.useQuery(
    { page, limit },
    { placeholderData: (prev: any) => prev }
  );

  const entries = data?.data ?? [];
  const hasMore = entries.length === limit;

  return (
    <div className="card px-6 py-5">
      <h3 className="text-sm font-semibold text-text-primary mb-4">Activity Log</h3>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton h-10 rounded" />
          ))}
        </div>
      )}

      {!isLoading && entries.length === 0 && (
        <p className="text-sm text-text-tertiary">No activity recorded yet.</p>
      )}

      {!isLoading && entries.length > 0 && (
        <>
          <div className="divide-y divide-border">
            {entries.map((entry) => {
              let meta: Record<string, unknown> = {};
              try {
                if (entry.metadata) meta = JSON.parse(entry.metadata);
              } catch {
                // ignore malformed metadata
              }

              const label = ACTION_LABELS[entry.action] ?? entry.action;
              const detail =
                (meta.invoiceNumber as string) ||
                (meta.paymentNumber as string) ||
                (meta.sourceName ? `${meta.sourceName} → ${meta.targetName}` : null) ||
                null;

              return (
                <div key={entry.id} className="py-3 flex items-start justify-between gap-4 text-sm">
                  <div>
                    <span className="text-text-primary font-medium">{label}</span>
                    {detail && (
                      <span className="text-text-tertiary ml-2">{detail}</span>
                    )}
                  </div>
                  <span className="text-xs text-text-tertiary whitespace-nowrap shrink-0">
                    {formatDate(entry.createdAt)}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex gap-3 mt-4">
            <button
              className="btn-ghost text-xs"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <span className="text-xs text-text-tertiary self-center">Page {page}</span>
            <button
              className="btn-ghost text-xs"
              disabled={!hasMore}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function AccountTab() {
  const { data: session } = trpc.auth.me.useQuery();
  const [showLogout, setShowLogout] = useState(false);
  const utils = trpc.useUtils();

  // Name editing state
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState(session?.user?.name || "");

  // Email change state
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
    onSuccess: () => {
      setEmailSent(true);
    },
    onError: (err) => toast.error("Failed", err.message),
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      toast.info("Logged out successfully");
      utils.auth.me.invalidate();
      window.location.href = "/login";
    },
    onError: (err) => {
      toast.error("Logout failed", err.message);
    },
  });

  return (
    <div className="space-y-6">
      {/* Profile info card */}
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
                <button
                  className="btn-ghost btn-sm"
                  onClick={() => setEditingName(false)}
                >
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
                <button
                  className="btn-ghost btn-sm"
                  onClick={() => setChangingEmail(false)}
                >
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

      {/* Activity log */}
      <AuditTrailCard />

      {/* Sign out */}
      <div className="card px-6 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Sign Out</h3>
            <p className="text-sm text-text-tertiary mt-0.5">Sign out of your account on this device</p>
          </div>
          <button className="btn-ghost text-red-600 hover:text-red-700" onClick={() => setShowLogout(true)}>
            Log out
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={showLogout}
        title="Log out?"
        description="You will be signed out of your account on this device."
        confirmLabel="Log out"
        variant="danger"
        loading={logoutMutation.isPending}
        onConfirm={() => logoutMutation.mutate()}
        onCancel={() => setShowLogout(false)}
      />
    </div>
  );
}
