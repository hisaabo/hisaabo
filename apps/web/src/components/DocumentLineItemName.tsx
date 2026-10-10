import { Link } from "@tanstack/react-router";

/**
 * Item-name cell for document line items. When the line references a catalogue
 * item (`itemId`), the name links to that item's detail (`/items?id=`) so the
 * browser back button returns to the document (detail panels are URL-addressed).
 * Free-text lines (no itemId) render as plain text.
 */
export function DocumentLineItemName({ itemId, name }: { itemId?: string | null; name: string }) {
  if (!itemId) return <p className="font-medium text-text-primary">{name}</p>;
  return (
    <p className="font-medium text-text-primary">
      <Link
        to="/items"
        search={{ id: itemId }}
        className="text-brand-600 hover:text-brand-700 hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {name}
      </Link>
    </p>
  );
}
