/**
 * topology.cjs — where each Playwright worker's isolated stack lives.
 *
 * Worker k (Playwright's `parallelIndex`, 0-based, stable across worker restarts)
 * gets its own database, API server and web server:
 *
 *   database   <DATABASE_URL's name>_w<k>   (cloned from DATABASE_URL's database)
 *   API        http://localhost:<API_URL port + k>
 *   web        http://localhost:<BASE_URL port + k>
 *
 * Shared by the supervisor (stack.mjs, plain node), global teardown and the test
 * helpers (Playwright's TypeScript loader). CommonJS because that is the one
 * module format both of those can load as-is.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const dotenv = require("dotenv");

const REPO = path.resolve(__dirname, "../..");

/** Memory budget per worker (API + Chromium + its share of the DB), in MB. */
const MB_PER_WORKER = 1500;
const MAX_DEFAULT_WORKERS = 4;

/** MemAvailable from /proc/meminfo (MemFree ignores reclaimable cache and badly under-reports). */
function availableMemoryMB() {
  try {
    const m = /^MemAvailable:\s+(\d+) kB/m.exec(fs.readFileSync("/proc/meminfo", "utf8"));
    if (m) return Math.floor(Number(m[1]) / 1024);
  } catch {
    /* not Linux */
  }
  return Math.floor(os.freemem() / 1024 / 1024);
}

/**
 * Number of workers (= isolated stacks). E2E_WORKERS wins; otherwise
 * min(4, floor(available memory / 1500MB)), at least 1. E2E_DEV=1 (one shared
 * dev stack) is always 1.
 */
function resolveWorkers(env = process.env) {
  if (env.E2E_DEV === "1") return 1;
  const requested = Number(env.E2E_WORKERS);
  if (Number.isInteger(requested) && requested >= 1) return requested;
  return Math.max(1, Math.min(MAX_DEFAULT_WORKERS, Math.floor(availableMemoryMB() / MB_PER_WORKER)));
}

function basePort(value, fallback) {
  return Number(new URL(value ?? fallback).port || 80);
}

/** @param {number} k worker index */
function workerPorts(k, env = process.env) {
  return {
    web: basePort(env.BASE_URL, "http://localhost:5173") + k,
    api: basePort(env.API_URL, "http://localhost:3000") + k,
  };
}

function webOrigin(k, env = process.env) {
  return `http://localhost:${workerPorts(k, env).web}`;
}

function apiOrigin(k, env = process.env) {
  return `http://localhost:${workerPorts(k, env).api}`;
}

/** DATABASE_URL, falling back to the repo-root .env like the API does. */
function baseDatabaseUrl(env = process.env) {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  try {
    const fromFile = dotenv.parse(fs.readFileSync(path.join(REPO, ".env"), "utf8")).DATABASE_URL;
    if (fromFile) return fromFile;
  } catch {
    /* no .env */
  }
  throw new Error("DATABASE_URL is required (set it in the environment or in the repo-root .env)");
}

function baseDatabaseName(env = process.env) {
  return decodeURIComponent(new URL(baseDatabaseUrl(env)).pathname.slice(1));
}

function workerDatabaseName(k, env = process.env) {
  return `${baseDatabaseName(env)}_w${k}`;
}

function workerDatabaseUrl(k, env = process.env) {
  const url = new URL(baseDatabaseUrl(env));
  url.pathname = `/${encodeURIComponent(workerDatabaseName(k, env))}`;
  return url.toString();
}

/** Connection URL for the maintenance database (CREATE/DROP DATABASE). */
function adminDatabaseUrl(env = process.env) {
  const url = new URL(baseDatabaseUrl(env));
  url.pathname = "/postgres";
  return url.toString();
}

/** Quote an identifier for CREATE/DROP DATABASE (which cannot take parameters). */
function quoteIdent(name) {
  return `"${name.replaceAll('"', '""')}"`;
}

module.exports = {
  REPO,
  MB_PER_WORKER,
  MAX_DEFAULT_WORKERS,
  availableMemoryMB,
  resolveWorkers,
  workerPorts,
  webOrigin,
  apiOrigin,
  baseDatabaseUrl,
  baseDatabaseName,
  workerDatabaseName,
  workerDatabaseUrl,
  adminDatabaseUrl,
  quoteIdent,
};
