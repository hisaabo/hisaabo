import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { PageHeader } from "@/components/ui/PageHeader";
import { InputField } from "@/components/ui/FormField";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { Listbox } from "@/components/ui/Listbox";
import { toast } from "@/hooks/useToast";
import { ImportWizard } from "@/components/ImportWizard";
import { useTheme } from "@/hooks/useTheme";
import { cn, formatDate } from "@/lib/utils";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { data: businesses, isLoading } = trpc.business.list.useQuery();
  const [editing, setEditing] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const biz = businesses?.[0];

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-8 w-32" />
        <div className="skeleton h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Settings" description="Manage your business profile" />

      {!biz ? (
        <BusinessForm onDone={() => setEditing(false)} />
      ) : !editing ? (
        <BusinessCard biz={biz} onEdit={() => setEditing(true)} />
      ) : (
        <BusinessForm existing={biz} onDone={() => setEditing(false)} />
      )}

      {/* Appearance */}
      <ThemeSection />

      {/* Team Management */}
      <TeamSection />

      {/* Import Data */}
      <div className="card px-6 py-5 mt-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Import Data</h3>
            <p className="text-sm text-text-tertiary mt-0.5">
              Migrate from myBillBook, Tally, or import CSV data
            </p>
          </div>
          <button className="btn-secondary" onClick={() => setShowImport(true)}>
            Start Import
          </button>
        </div>
      </div>

      <ImportWizard open={showImport} onClose={() => setShowImport(false)} />

      {/* Logout */}
      <div className="mt-8 pt-6 border-t border-border-light">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-text-primary">Sign out</p>
            <p className="text-xs text-text-tertiary mt-0.5">Sign out of your account on this device</p>
          </div>
          <button
            className="btn-ghost text-red-600 hover:text-red-700"
            onClick={() => setShowLogoutConfirm(true)}
          >
            Log out
          </button>
        </div>
      </div>

      <LogoutConfirm
        open={showLogoutConfirm}
        onCancel={() => setShowLogoutConfirm(false)}
      />
    </div>
  );
}

// ── Appearance / Theme ─────────────────────────────────────────

type ThemeOption = { value: "light" | "dark" | "system"; label: string; description: string };

const themeOptions: ThemeOption[] = [
  { value: "system", label: "System", description: "Follows your OS preference" },
  { value: "light", label: "Light", description: "Always use the light theme" },
  { value: "dark", label: "Dark", description: "Always use the dark theme" },
];

function ThemeSection() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="card px-6 py-5 mt-6">
      <h3 className="text-sm font-semibold text-text-primary mb-1">Appearance</h3>
      <p className="text-sm text-text-tertiary mb-4">Choose how Hisaabo looks on this device</p>
      <div className="flex gap-3">
        {themeOptions.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setTheme(opt.value)}
            className={cn(
              "flex-1 flex flex-col items-start px-4 py-3 rounded-lg border text-left transition-colors",
              theme === opt.value
                ? "border-brand-500 bg-brand-600/5 text-brand-700 dark:text-brand-400"
                : "border-border-light hover:border-border-color hover:bg-surface-1 text-text-secondary",
            )}
          >
            <span className="text-sm font-medium">{opt.label}</span>
            <span className="text-xs mt-0.5 text-text-tertiary">{opt.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Team Management ────────────────────────────────────────────

const roleOptions = [
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
  { value: "viewer", label: "Viewer" },
];

function TeamSection() {
  const { data: session } = trpc.auth.me.useQuery();
  const { data: members, isLoading } = trpc.tenant.members.useQuery(undefined, {
    enabled: !!session?.tenantId,
  });
  const utils = trpc.useUtils();
  const [showInvite, setShowInvite] = useState(false);

  const removeMember = trpc.tenant.removeMember.useMutation({
    onSuccess: () => {
      toast.success("Member removed");
      utils.tenant.members.invalidate();
    },
    onError: (err) => toast.error("Failed to remove member", err.message),
  });

  const updateRole = trpc.tenant.updateMemberRole.useMutation({
    onSuccess: () => {
      toast.success("Role updated");
      utils.tenant.members.invalidate();
    },
    onError: (err) => toast.error("Failed to update role", err.message),
  });

  // Determine caller's role
  const { data: me } = trpc.auth.me.useQuery();
  const callerMember = members?.find((m) => m.userEmail === me?.user?.email);
  const canManage = callerMember?.role === "owner" || callerMember?.role === "admin";

  if (!session?.tenantId) return null;

  return (
    <>
      <div className="card overflow-hidden mt-6">
        <div className="px-6 py-4 flex items-center justify-between border-b border-border-light">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Team Members</h3>
            <p className="text-xs text-text-tertiary mt-0.5">
              Manage who has access to this organization
            </p>
          </div>
          {canManage && (
            <button className="btn-primary btn-sm" onClick={() => setShowInvite(true)}>
              + Invite
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="px-6 py-8 space-y-3">
            <div className="skeleton h-5 rounded" />
            <div className="skeleton h-5 rounded" />
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Joined</th>
                {canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {members?.map((m) => (
                <tr key={m.id}>
                  <td className="font-medium">{m.userName}</td>
                  <td className="text-text-secondary">{m.userEmail}</td>
                  <td>
                    <span
                      className={cn(
                        "px-2 py-0.5 rounded text-[11px] font-medium",
                        m.role === "owner"
                          ? "bg-brand-600/[0.08] text-brand-700 dark:text-brand-400"
                          : m.role === "admin"
                            ? "bg-emerald-600/[0.08] text-emerald-700 dark:text-emerald-400"
                            : "bg-surface-2 text-text-secondary",
                      )}
                    >
                      {m.role}
                    </span>
                  </td>
                  <td className="text-text-secondary text-xs">
                    {m.acceptedAt ? formatDate(m.acceptedAt) : "Pending"}
                  </td>
                  {canManage && (
                    <td className="text-right">
                      {m.role !== "owner" && m.userEmail !== me?.user?.email && (
                        <div className="flex items-center justify-end gap-2">
                          {/* Role change dropdown */}
                          <div className="w-28">
                            <Listbox
                              value={m.role}
                              onChange={(role) =>
                                updateRole.mutate({ userId: m.userId, role: role as "admin" | "member" | "viewer" })
                              }
                              options={roleOptions}
                            />
                          </div>
                          {/* Remove button */}
                          <button
                            onClick={() => removeMember.mutate({ userId: m.userId })}
                            disabled={removeMember.isPending}
                            className="btn-ghost text-red-600 hover:text-red-700 text-xs px-2 py-1"
                            title="Remove member"
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <InviteModal
        open={showInvite}
        onClose={() => setShowInvite(false)}
      />
    </>
  );
}

// ── Invite Modal ───────────────────────────────────────────────

function InviteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [inviteResult, setInviteResult] = useState<{ token: string; inviteLink: string } | null>(null);
  const utils = trpc.useUtils();

  const inviteMutation = trpc.tenant.inviteMember.useMutation({
    onSuccess: (data) => {
      const inviteLink = `/invite/${data.token}`;
      setInviteResult({ token: data.token, inviteLink });
      toast.success("Invitation created");
      utils.tenant.members.invalidate();
    },
    onError: (err) => toast.error("Failed to send invite", err.message),
  });

  function handleClose() {
    setEmail("");
    setRole("member");
    setInviteResult(null);
    onClose();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    inviteMutation.mutate({ email, role: role as "admin" | "member" | "viewer" });
  }

  return (
    <Modal open={open} onClose={handleClose} title="Invite Team Member">
      {inviteResult ? (
        <div className="space-y-4 py-2">
          <div className="rounded-lg bg-emerald-600/[0.08] border border-emerald-200 dark:border-emerald-800 px-4 py-3">
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Invitation created!</p>
            <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">
              Share this link with {email} to give them access.
            </p>
          </div>
          <div>
            <label className="label">Invite Link</label>
            <div className="flex gap-2">
              <input
                readOnly
                value={`${window.location.origin}${inviteResult.inviteLink}`}
                className="input flex-1 font-mono text-xs"
              />
              <button
                type="button"
                className="btn-secondary shrink-0"
                onClick={() => {
                  navigator.clipboard.writeText(
                    `${window.location.origin}${inviteResult.inviteLink}`,
                  );
                  toast.success("Copied to clipboard");
                }}
              >
                Copy
              </button>
            </div>
          </div>
          <button className="btn-primary w-full" onClick={handleClose}>
            Done
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div>
            <label className="label">Email address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="input"
              placeholder="colleague@example.com"
              autoFocus
            />
          </div>
          <div>
            <Listbox
              label="Role"
              value={role}
              onChange={setRole}
              options={roleOptions}
            />
          </div>
          <div className="pt-1 flex gap-3">
            <button type="button" className="btn-secondary flex-1" onClick={handleClose}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={inviteMutation.isPending}
              className="btn-primary flex-1"
            >
              {inviteMutation.isPending ? "Sending..." : "Send Invite"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ── Business Card / Form ───────────────────────────────────────

function BusinessCard({ biz, onEdit }: { biz: any; onEdit: () => void }) {
  const fields: [string, string | undefined | null][] = [
    ["Legal Name", biz.legalName],
    ["GSTIN", biz.gstin],
    ["PAN", biz.pan],
    ["Phone", biz.phone],
    ["Email", biz.email],
    ["Address", biz.address],
    ["City", biz.city],
    ["State", biz.state],
    ["Pincode", biz.pincode],
    ["Currency", biz.currency],
  ];

  const prefixFields: [string, string | undefined | null][] = [
    ["Invoice Prefix", biz.invoicePrefix],
    ["Payment Prefix", biz.paymentPrefix],
    ["Quotation Prefix", biz.quotationPrefix],
    ["Credit Note Prefix", biz.creditNotePrefix],
    ["Delivery Challan Prefix", biz.deliveryChallanPrefix],
    ["Proforma Prefix", biz.proformaPrefix],
  ];

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-text-primary">{biz.name}</h3>
        <button className="btn-secondary" onClick={onEdit}>Edit</button>
      </div>

      <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
        {fields.map(([label, value]) => (
          <div key={label}>
            <span className="text-xs text-text-tertiary">{label}</span>
            <p className={value ? "text-text-primary" : "text-text-tertiary"}>
              {value || "—"}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-5 pt-4 border-t border-border-light">
        <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-3">
          Document Prefixes
        </p>
        <div className="grid grid-cols-3 gap-x-8 gap-y-3 text-sm">
          {prefixFields.map(([label, value]) => (
            <div key={label}>
              <span className="text-xs text-text-tertiary">{label}</span>
              <p className="text-text-primary font-mono">{value || "—"}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BusinessForm({ existing, onDone }: { existing?: any; onDone: () => void }) {
  const [name, setName] = useState(existing?.name || "");
  const [legalName, setLegalName] = useState(existing?.legalName || "");
  const [gstin, setGstin] = useState(existing?.gstin || "");
  const [pan, setPan] = useState(existing?.pan || "");
  const [phone, setPhone] = useState(existing?.phone || "");
  const [email, setEmail] = useState(existing?.email || "");
  const [address, setAddress] = useState(existing?.address || "");
  const [city, setCity] = useState(existing?.city || "");
  const [stateName, setStateName] = useState(existing?.state || "");
  const [pincode, setPincode] = useState(existing?.pincode || "");
  const [invoicePrefix, setInvoicePrefix] = useState(existing?.invoicePrefix || "INV");
  const [paymentPrefix, setPaymentPrefix] = useState(existing?.paymentPrefix || "PAY");
  const [quotationPrefix, setQuotationPrefix] = useState(existing?.quotationPrefix || "QTN");
  const [creditNotePrefix, setCreditNotePrefix] = useState(existing?.creditNotePrefix || "CN");
  const [deliveryChallanPrefix, setDeliveryChallanPrefix] = useState(existing?.deliveryChallanPrefix || "DC");
  const [proformaPrefix, setProformaPrefix] = useState(existing?.proformaPrefix || "PI");

  const utils = trpc.useUtils();

  const createMutation = trpc.business.create.useMutation({
    onSuccess: () => {
      toast.success("Business created successfully");
      utils.business.list.invalidate();
      onDone();
    },
    onError: (err) => {
      toast.error("Failed to create business", err.message);
    },
  });

  const updateMutation = trpc.business.update.useMutation({
    onSuccess: () => {
      toast.success("Business updated successfully");
      utils.business.list.invalidate();
      onDone();
    },
    onError: (err) => {
      toast.error("Failed to update business", err.message);
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const data = {
      name,
      legalName: legalName || undefined,
      gstin: gstin || undefined,
      pan: pan || undefined,
      phone: phone || undefined,
      email: email || undefined,
      address: address || undefined,
      city: city || undefined,
      state: stateName || undefined,
      pincode: pincode || undefined,
      invoicePrefix,
      paymentPrefix,
      quotationPrefix,
      creditNotePrefix,
      deliveryChallanPrefix,
      proformaPrefix,
    };
    if (existing) {
      updateMutation.mutate({ id: existing.id, data });
    } else {
      createMutation.mutate(data);
    }
  }

  return (
    <div className="card p-6">
      <h2 className="text-base font-semibold text-text-primary mb-5">
        {existing ? "Edit Business" : "Set Up Your Business"}
      </h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Business Info */}
        <div className="grid grid-cols-2 gap-4">
          <InputField
            label="Business Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <InputField
            label="Legal Name"
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
          />
        </div>

        {/* Tax Info */}
        <div className="grid grid-cols-2 gap-4">
          <InputField
            label="GSTIN"
            value={gstin}
            onChange={(e) => setGstin(e.target.value)}
            placeholder="22AAAAA0000A1Z5"
          />
          <InputField
            label="PAN"
            value={pan}
            onChange={(e) => setPan(e.target.value)}
            placeholder="AAAAA0000A"
          />
        </div>

        {/* Contact */}
        <div className="grid grid-cols-2 gap-4">
          <InputField
            label="Phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            type="tel"
          />
          <InputField
            label="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
          />
        </div>

        {/* Address */}
        <InputField
          label="Address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <div className="grid grid-cols-3 gap-4">
          <InputField
            label="City"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          />
          <InputField
            label="State"
            value={stateName}
            onChange={(e) => setStateName(e.target.value)}
          />
          <InputField
            label="Pincode"
            value={pincode}
            onChange={(e) => setPincode(e.target.value)}
          />
        </div>

        {/* Document Prefixes */}
        <div>
          <h3 className="text-sm font-semibold text-text-primary mt-2 mb-3">Document Prefixes</h3>
          <div className="grid grid-cols-3 gap-4">
            <InputField
              label="Invoice Prefix"
              value={invoicePrefix}
              onChange={(e) => setInvoicePrefix(e.target.value)}
              required
            />
            <InputField
              label="Payment Prefix"
              value={paymentPrefix}
              onChange={(e) => setPaymentPrefix(e.target.value)}
              required
            />
            <InputField
              label="Quotation Prefix"
              value={quotationPrefix}
              onChange={(e) => setQuotationPrefix(e.target.value)}
              required
            />
            <InputField
              label="Credit Note Prefix"
              value={creditNotePrefix}
              onChange={(e) => setCreditNotePrefix(e.target.value)}
              required
            />
            <InputField
              label="Delivery Challan Prefix"
              value={deliveryChallanPrefix}
              onChange={(e) => setDeliveryChallanPrefix(e.target.value)}
              required
            />
            <InputField
              label="Proforma Prefix"
              value={proformaPrefix}
              onChange={(e) => setProformaPrefix(e.target.value)}
              required
            />
          </div>
        </div>

        {/* Currency (readonly) */}
        <InputField
          label="Currency"
          value="INR"
          readOnly
          className="opacity-60 cursor-not-allowed"
        />

        <div className="flex gap-3 pt-2">
          {existing && (
            <button
              type="button"
              onClick={onDone}
              className="btn-secondary flex-1"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={isPending}
            className="btn-primary flex-1"
          >
            {isPending ? "Saving..." : existing ? "Save Changes" : "Create Business"}
          </button>
        </div>
      </form>
    </div>
  );
}

function LogoutConfirm({ open, onCancel }: { open: boolean; onCancel: () => void }) {
  const utils = trpc.useUtils();
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
    <ConfirmDialog
      open={open}
      title="Log out?"
      description="You will be signed out of your account on this device."
      confirmLabel="Log out"
      variant="danger"
      loading={logoutMutation.isPending}
      onConfirm={() => logoutMutation.mutate()}
      onCancel={onCancel}
    />
  );
}
