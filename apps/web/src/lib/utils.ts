export function formatCurrency(amount: string | number, currency = "INR"): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

export function formatDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

export function formatDateInput(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toISOString().split("T")[0];
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function getStatusColor(status: string): string {
  switch (status) {
    case "paid": return "text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950";
    case "sent": return "text-blue-700 bg-blue-50 dark:text-blue-400 dark:bg-blue-950";
    case "draft": return "text-text-secondary bg-surface-2";
    case "partial": return "text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-950";
    case "overdue": return "text-red-700 bg-red-50 dark:text-red-400 dark:bg-red-950";
    case "cancelled": return "text-text-tertiary bg-surface-2";
    default: return "text-text-secondary bg-surface-2";
  }
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function getDocumentTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    invoice: "Invoice",
    quotation: "Quotation",
    credit_note: "Credit Note",
    debit_note: "Debit Note",
    delivery_challan: "Delivery Challan",
    proforma: "Proforma Invoice",
    sales_return: "Sales Return",
    purchase_return: "Purchase Return",
  };
  return labels[type] || type;
}

export function getDocumentTypeColor(type: string): string {
  const colors: Record<string, string> = {
    invoice: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
    quotation: "bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-400",
    credit_note: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
    debit_note: "bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-400",
    delivery_challan: "bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-400",
    proforma: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400",
    sales_return: "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-400",
    purchase_return: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
  };
  return colors[type] || "bg-surface-2 text-text-secondary";
}

export function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const csv = [
    headers.join(","),
    ...rows.map((r) =>
      r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
    ),
  ].join("\n");

  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
