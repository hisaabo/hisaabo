import { checkStoreSlugReserved } from "@hisaabo/shared";

/**
 * The store URL slug is set once. It is locked as soon as a slug exists,
 * unless the system auto-assigned it (duplicate-slug rename), in which case
 * the user may choose a new one exactly once. The API enforces the same rule.
 */
export function isStoreSlugLocked(storeSlug: string | null | undefined, autoAssigned: boolean | null | undefined): boolean {
  return !!storeSlug && !autoAssigned;
}

/** Whether to show the "your link was changed" notice. */
export function showAutoAssignedNotice(storeSlug: string | null | undefined, autoAssigned: boolean | null | undefined): boolean {
  return !!storeSlug && !!autoAssigned;
}

/**
 * Client-side mirror of the API's reserved-slug rule, so the form can show the
 * error before submit. Returns the message, or null when the slug is fine.
 * A locked field is not being edited, and a business that already holds a
 * reserved slug (grandfathered) may keep it: both return null.
 */
export function reservedStoreSlugError(
  slug: string | null | undefined,
  currentSlug: string | null | undefined,
  locked: boolean,
): string | null {
  if (locked) return null;
  return checkStoreSlugReserved(slug, currentSlug);
}
