/**
 * PartyCombobox — reusable party search picker.
 *
 * Wraps Combobox with server-side debounced search via trpc.party.list.
 * Use this everywhere a party needs to be selected instead of rolling
 * custom party queries + options mapping in each consumer.
 */

import { useMemo, useState } from "react";
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
  autoFocus?: boolean;
}

export function PartyCombobox({
  value,
  onChange,
  partyType,
  label = "Party",
  required,
  error,
  placeholder = "Search parties...",
  autoFocus,
}: PartyComboboxProps) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const { data, isFetching } = trpc.party.list.useQuery({
    type: partyType,
    search: debouncedSearch || undefined,
    page: 1,
    limit: 50,
  });

  // When the combobox is mounted with a pre-selected value (e.g. Record
  // Payment opened from an invoice slider), the party may not appear in the
  // first 50 paginated results — and an empty search filter doesn't help
  // when there are hundreds of customers. Fetch the selected party by id
  // so the input always shows its name on first render.
  const { data: selectedParty } = trpc.party.getById.useQuery(
    { id: value },
    { enabled: !!value }
  );

  const options: ComboboxOption[] = useMemo(() => {
    const list = (data?.data ?? []).map((p) => ({
      value: p.id,
      label: p.name,
      description: p.type === "customer" ? "Customer" : "Supplier",
    }));
    if (selectedParty && !list.some((o) => o.value === selectedParty.id)) {
      list.unshift({
        value: selectedParty.id,
        label: selectedParty.name,
        description: selectedParty.type === "customer" ? "Customer" : "Supplier",
      });
    }
    return list;
  }, [data, selectedParty]);

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
      autoFocus={autoFocus}
    />
  );
}
