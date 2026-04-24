/**
 * MaintenanceBanner — banner component tests
 *
 * Covers the three rendering paths:
 *   1. null when trpc has no data or neither active nor scheduled
 *   2. red "active" banner when data.enabled is true
 *   3. amber "scheduled" banner when a future startsAt exists and enabled=false
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { maintenanceData } = vi.hoisted(() => ({
  maintenanceData: { current: undefined as any },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    system: {
      maintenanceStatus: {
        useQuery: () => ({ data: maintenanceData.current }),
      },
    },
  },
}));

import { MaintenanceBanner } from "../MaintenanceBanner";

describe("MaintenanceBanner", () => {
  beforeEach(() => {
    maintenanceData.current = undefined;
  });

  it("renders nothing when trpc query has no data yet", () => {
    maintenanceData.current = undefined;
    const { container } = render(<MaintenanceBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when neither active nor scheduled", () => {
    maintenanceData.current = { enabled: false, startsAt: null, endsAt: null, message: "" };
    const { container } = render(<MaintenanceBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when startsAt is in the past (no longer scheduled)", () => {
    maintenanceData.current = {
      enabled: false,
      startsAt: "2020-01-01T00:00:00.000Z",
      endsAt: null,
      message: "Old one",
    };
    const { container } = render(<MaintenanceBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("active: shows custom message and estimated end time when endsAt is provided", () => {
    maintenanceData.current = {
      enabled: true,
      startsAt: null,
      endsAt: "2030-01-15T14:30:00.000Z",
      message: "Taking the servers down for a bit.",
    };
    render(<MaintenanceBanner />);

    expect(screen.getByText("Taking the servers down for a bit.")).toBeInTheDocument();
    expect(screen.getByText(/Estimated end:/i)).toBeInTheDocument();
  });

  it("active: falls back to default copy when message is empty", () => {
    maintenanceData.current = {
      enabled: true,
      startsAt: null,
      endsAt: null,
      message: "",
    };
    render(<MaintenanceBanner />);

    expect(screen.getByText(/system is under maintenance/i)).toBeInTheDocument();
  });

  it("active: omits the 'Estimated end' span when endsAt is null", () => {
    maintenanceData.current = {
      enabled: true,
      startsAt: null,
      endsAt: null,
      message: "Down.",
    };
    render(<MaintenanceBanner />);

    expect(screen.queryByText(/estimated end:/i)).not.toBeInTheDocument();
  });

  it("active: renders '—' placeholder when endsAt is not a valid ISO string", () => {
    maintenanceData.current = {
      enabled: true,
      startsAt: null,
      endsAt: "garbage-not-a-date",
      message: "Down.",
    };
    render(<MaintenanceBanner />);

    // formatTime returns '—' for invalid dates; the banner embeds it after "Estimated end:"
    expect(screen.getByText(/estimated end: —/i)).toBeInTheDocument();
  });

  it("scheduled: shows startsAt and suffixed message", () => {
    maintenanceData.current = {
      enabled: false,
      startsAt: "2030-06-01T09:00:00.000Z",
      endsAt: null,
      message: "Planned upgrade window.",
    };
    render(<MaintenanceBanner />);

    expect(screen.getByText(/scheduled maintenance:/i)).toBeInTheDocument();
    expect(screen.getByText(/Planned upgrade window\./)).toBeInTheDocument();
  });

  it("scheduled: omits trailing message chunk when message is empty", () => {
    maintenanceData.current = {
      enabled: false,
      startsAt: "2030-06-01T09:00:00.000Z",
      endsAt: null,
      message: "",
    };
    render(<MaintenanceBanner />);

    expect(screen.getByText(/scheduled maintenance:/i)).toBeInTheDocument();
    // The "— " separator span is only rendered when message is truthy
    expect(screen.queryByText(/^—/)).not.toBeInTheDocument();
  });
});
