import { and, gt, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { controlDb, invitations, users } from "@hisaabo/db";
import { emailEq } from "./normalize-email.js";

// Self-hosted servers are invite-only after the first owner unless
// ALLOW_OPEN_SIGNUP=true. Multi-tenant (cloud) signup is unaffected.
const SIGNUP_LOCK_KEY = 7_204_150_001;
export const SIGNUP_CLOSED_MESSAGE = "Sign-up on this server is by invitation only";

export type ControlTx = Parameters<Parameters<typeof controlDb.transaction>[0]>[0];

export function isMultiTenant(): boolean {
  return process.env.MULTI_TENANT === "true";
}

export function isOpenSignupEnabled(): boolean {
  return process.env.ALLOW_OPEN_SIGNUP === "true";
}

export async function hasPendingInvitation(db: ControlTx | typeof controlDb, email: string): Promise<boolean> {
  const [row] = await db.select({ id: invitations.id })
    .from(invitations)
    .where(and(
      emailEq(invitations.email, email),
      isNull(invitations.acceptedAt),
      gt(invitations.expiresAt, new Date()),
    ))
    .limit(1);
  return !!row;
}

/** Serialises self-hosted owner/signup decisions for the rest of the transaction. */
export async function lockSignup(tx: ControlTx): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${SIGNUP_LOCK_KEY})`);
}

/**
 * Rejects uninvited self-hosted signups once the server has users. Must run
 * inside the transaction that creates the user, before the insert.
 */
export async function enforceSelfHostedSignup(tx: ControlTx, email: string): Promise<void> {
  if (isMultiTenant()) return;
  await lockSignup(tx);
  if (isOpenSignupEnabled()) return;
  const [anyUser] = await tx.select({ id: users.id }).from(users).limit(1);
  if (!anyUser) return;
  if (!(await hasPendingInvitation(tx, email))) {
    throw new TRPCError({ code: "FORBIDDEN", message: SIGNUP_CLOSED_MESSAGE });
  }
}

/** True when a visitor could create an account on this server right now. */
export async function isSignupOpen(): Promise<boolean> {
  if (isMultiTenant() || isOpenSignupEnabled()) return true;
  const [anyUser] = await controlDb.select({ id: users.id }).from(users).limit(1);
  return !anyUser;
}
