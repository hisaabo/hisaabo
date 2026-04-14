import { trpc } from "@/lib/trpc";

export function MaintenanceBanner() {
  const { data } = trpc.system.maintenanceStatus.useQuery(undefined, {
    refetchInterval: 30_000,
    retry: 1,
  });

  if (!data) return null;

  const now = new Date();
  const isActive = data.enabled;
  const isScheduled =
    !data.enabled && data.startsAt && new Date(data.startsAt) > now;

  if (!isActive && !isScheduled) return null;

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (isActive) {
    return (
      <div className="bg-red-600 text-white px-4 py-2 text-center text-sm font-medium">
        <span>{data.message || "System is under maintenance."}</span>
        {data.endsAt && (
          <span className="ml-2 opacity-90">
            Estimated end: {formatTime(data.endsAt)}
          </span>
        )}
      </div>
    );
  }

  // Scheduled
  return (
    <div className="bg-amber-500 text-amber-950 px-4 py-2 text-center text-sm font-medium">
      <span>Scheduled maintenance: {formatTime(data.startsAt!)}</span>
      {data.message && <span className="ml-2">— {data.message}</span>}
    </div>
  );
}
