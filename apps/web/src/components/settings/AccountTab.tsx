import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { toast } from "@/hooks/useToast";

export function AccountTab() {
  const { data: session } = trpc.auth.me.useQuery();
  const [showLogout, setShowLogout] = useState(false);
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
    <div className="space-y-6">
      {/* Profile info card */}
      <div className="card px-6 py-5">
        <h3 className="text-sm font-semibold text-text-primary mb-4">Your Profile</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-xs text-text-tertiary">Name</span>
            <p className="text-text-primary">{session?.user?.name || "—"}</p>
          </div>
          <div>
            <span className="text-xs text-text-tertiary">Email</span>
            <p className="text-text-primary">{session?.user?.email || "—"}</p>
          </div>
        </div>
      </div>

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
