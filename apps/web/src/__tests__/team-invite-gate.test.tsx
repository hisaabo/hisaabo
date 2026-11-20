/**
 * Team tab: when the server says an account may not invite members or change roles
 * (cloud, unverified email), the Invite button and the role selectors are hidden
 * and the reason is shown; removing a member stays available.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const state = vi.hoisted(() => ({
  invite: { data: { allowed: true, reason: null } as { allowed: boolean; reason: string | null } | undefined },
}));

vi.mock("@/lib/trpc", () => {
  const mutation = () => ({ mutate: vi.fn(), isPending: false });
  return {
  trpc: {
    useUtils: () => ({ tenant: { members: { invalidate: vi.fn() }, pendingInvitations: { invalidate: vi.fn() } } }),
    auth: {
      me: { useQuery: () => ({ data: { tenantId: "t1", user: { email: "owner@example.com" } } }) },
    },
    tenant: {
      members: {
        useQuery: () => ({
          isLoading: false,
          data: [
            { id: "m1", userId: "u1", role: "owner", acceptedAt: new Date(), userName: "Owner", userEmail: "owner@example.com" },
            { id: "m2", userId: "u2", role: "seller", acceptedAt: new Date(), userName: "Seller", userEmail: "seller@example.com" },
          ],
        }),
      },
      pendingInvitations: { useQuery: () => ({ data: [] }) },
      canInviteMembers: { useQuery: () => state.invite },
      removeMember: { useMutation: mutation },
      updateMemberRole: { useMutation: mutation },
      revokeInvitation: { useMutation: mutation },
      inviteMember: { useMutation: mutation },
    },
  },
  };
});

import { TeamTab } from "../components/settings/TeamTab";

describe("TeamTab invite gate", () => {
  beforeEach(() => {
    state.invite = { data: { allowed: true, reason: null } };
  });

  it("allowed: shows Invite and the role selector", () => {
    render(<TeamTab />);
    expect(screen.getByRole("button", { name: "+ Invite" })).toBeInTheDocument();
    expect(screen.getByText("Remove")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("email_unverified: hides Invite and role selectors, explains why, keeps Remove", () => {
    state.invite = { data: { allowed: false, reason: "email_unverified" } };
    render(<TeamTab />);
    expect(screen.queryByRole("button", { name: "+ Invite" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Verify your email address before inviting or changing team members");
    expect(screen.getByText("Remove")).toBeInTheDocument();
    // The role selector (Listbox) is not rendered for the member row.
    expect(screen.queryByRole("button", { name: /seller/i })).toBeNull();
  });

  it("while the permission is still loading nothing is hidden", () => {
    state.invite = { data: undefined };
    render(<TeamTab />);
    expect(screen.getByRole("button", { name: "+ Invite" })).toBeInTheDocument();
  });
});
