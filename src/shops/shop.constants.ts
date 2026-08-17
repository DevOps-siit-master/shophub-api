import { createHash } from 'node:crypto';

/** CRD group/version shared by all shop-related custom resources. */
export const CRD_GROUP = 'shophub.devops-siit.io';
export const CRD_VERSION = 'v1';

/** Plural name as registered by the shop-operator Shop CRD. */
export const PLURAL_SHOPS = 'shops';

/** Labels used to scope and identify resources managed by this service. */
export const LABEL_OWNER = 'shophub.devops-siit.io/owner';
export const LABEL_MANAGED_BY = 'app.kubernetes.io/managed-by';
export const MANAGED_BY = 'shophub-api';

/** Annotations for bookkeeping the Shop spec has no field for. */
export const ANNOTATION_OWNER_ID = 'shophub.devops-siit.io/owner-id';
export const ANNOTATION_DISPLAY_NAME = 'shophub.devops-siit.io/display-name';

export type Availability = 'standard' | 'high';
export type DatabaseType = 'standard' | 'light';

export const AVAILABILITIES: Availability[] = ['standard', 'high'];
export const DATABASE_TYPES: DatabaseType[] = ['standard', 'light'];

/** Replica count the operator uses per availability tier (spec 1.2 / 3.1). */
export function replicasFor(availability: Availability): number {
  return availability === 'high' ? 3 : 2;
}

/**
 * Deterministic short, label-safe hash of a user id. Used both as the owner
 * label value (for filtering) and as a suffix that keeps CR names unique across
 * users who pick the same shop name.
 */
export function ownerHash(userId: string): string {
  return createHash('sha256').update(userId).digest('hex').slice(0, 10);
}

/**
 * Turns a human display name into a DNS-1123 label fragment (lowercase
 * alphanumerics and single dashes), capped so the derived resource names stay
 * within the 63-character limit.
 */
export function slugify(displayName: string): string {
  const slug = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');
  return slug || 'shop';
}

/** Builds the unique Shop CR name for a given owner + display name. */
export function shopName(displayName: string, userId: string): string {
  return `${slugify(displayName)}-${ownerHash(userId)}`;
}
