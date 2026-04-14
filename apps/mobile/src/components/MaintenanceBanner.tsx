import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { trpc } from "../lib/trpc";

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

  const bgColor = isActive ? "#dc2626" : "#f59e0b";
  const textColor = isActive ? "#ffffff" : "#451a03";

  let text = "";
  if (isActive) {
    text = data.message || "System is under maintenance.";
    if (data.endsAt) text += ` Estimated end: ${formatTime(data.endsAt)}`;
  } else {
    text = `Scheduled maintenance: ${formatTime(data.startsAt!)}`;
    if (data.message) text += ` — ${data.message}`;
  }

  return (
    <View style={[styles.container, { backgroundColor: bgColor }]}>
      <Text style={[styles.text, { color: textColor }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: "center",
  },
  text: {
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
});
