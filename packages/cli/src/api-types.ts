/**
 * Type-only bridge to the server's tRPC router. Nothing here exists at runtime
 * (type-only imports are erased), so the published bundle never pulls in
 * @hisaabo/api or @trpc/server. Drift between client calls and the router
 * fails `pnpm typecheck`.
 */
import type { AppRouter } from "@hisaabo/api";

type ProcedureRecord = AppRouter["_def"]["procedures"];

/** Anything the router exposes as a callable procedure (leaf of the nested record). */
type AnyLeaf = { _def: { type: "query" | "mutation" | "subscription" } };

/** Flattens the nested router record into `{ "router.proc": procedure }`. */
type Flatten<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends AnyLeaf
    ? { [P in `${Prefix}${K}`]: T[K] }
    : Flatten<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void ? I : never;

type Procedures = UnionToIntersection<Flatten<ProcedureRecord>>;

type PathsOfType<K extends "query" | "mutation"> = {
  [P in keyof Procedures]: Procedures[P] extends { _def: { type: K } } ? P : never;
}[keyof Procedures] &
  string;

export type QueryPath = PathsOfType<"query">;
export type MutationPath = PathsOfType<"mutation">;

export type InputOf<P extends keyof Procedures> = Procedures[P] extends { _def: { $types: { input: infer I } } } ? I : never;
export type OutputOf<P extends keyof Procedures> = Procedures[P] extends { _def: { $types: { output: infer O } } } ? O : never;

/** Rest-args tuple: the input is optional exactly when the procedure takes none/optional input. */
export type InputArgs<P extends keyof Procedures> = undefined extends InputOf<P>
  ? [input?: InputOf<P>]
  : [input: InputOf<P>];
