import { View, Text, StyleSheet } from "react-native";

const STATUS_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: "rgba(107, 114, 128, 0.2)", text: "#9ca3af", label: "Draft" },
  unfulfilled: { bg: "rgba(59, 130, 246, 0.2)", text: "#60a5fa", label: "Unfulfilled" },
  sent: { bg: "rgba(59, 130, 246, 0.2)", text: "#60a5fa", label: "Sent" },
  paid: { bg: "rgba(16, 185, 129, 0.2)", text: "#34d399", label: "Paid" },
  partial: { bg: "rgba(245, 158, 11, 0.2)", text: "#fbbf24", label: "Partial" },
  overdue: { bg: "rgba(239, 68, 68, 0.2)", text: "#f87171", label: "Overdue" },
  cancelled: { bg: "rgba(107, 114, 128, 0.15)", text: "#6b7280", label: "Cancelled" },
  pending: { bg: "rgba(245, 158, 11, 0.2)", text: "#fbbf24", label: "Pending" },
  confirmed: { bg: "rgba(59, 130, 246, 0.2)", text: "#60a5fa", label: "Confirmed" },
  delivered: { bg: "rgba(16, 185, 129, 0.2)", text: "#34d399", label: "Delivered" },
};

export function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.draft;
  return (
    <View style={[styles.badge, { backgroundColor: config.bg }]}>
      <Text style={[styles.text, { color: config.text }]}>{config.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  text: { fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
});
