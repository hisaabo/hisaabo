/**
 * PartyCombobox — reusable party search picker.
 *
 * Wraps Combobox with server-side debounced search via trpc.party.list.
 * Use this everywhere a party needs to be selected instead of rolling
 * custom party queries + options mapping in each consumer.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useDebounce } from "@/hooks/useDebounce";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";

interface PartyComboboxProps {
  value: string;
  onChange: (partyId: string) => void;
  /** Filter by party type — omit to show all */
  partyType?: "customer" | "supplier";
  label?: string;
  required?: boolean;
  error?: string;
  placeholder?: string;
}

export function PartyCombobox({
  value,
  onChange,
  partyType,
  label = "Party",
  required,
  error,
  placeholder = "Search parties...",
}: PartyComboboxProps) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const { data, isFetching } = trpc.party.list.useQuery({
    type: partyType,
    search: debouncedSearch || undefined,
    page: 1,
    limit: 50,
  });

  const options: ComboboxOption[] = (data?.data ?? []).map((p) => ({
    value: p.id,
    label: p.name,
    description: p.type === "customer" ? "Customer" : "Supplier",
  }));

  return (
    <Combobox
      label={label}
      required={required}
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      emptyMessage="No parties found"
      onQueryChange={setSearch}
      isLoading={isFetching && !!debouncedSearch}
      error={error}
    />
  );
}
