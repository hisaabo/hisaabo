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
