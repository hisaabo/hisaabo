import { describe, it, expect } from "vitest";
import {
  MAX_DEFAULT_API_WORKERS,
  MB_PER_API_WORKER,
  databaseNameOf,
  resolveWorkerCount,
  withDatabase,
  workerDbName,
} from "../helpers/worker-db-config.js";

describe("resolveWorkerCount", () => {
  const big = { freeMb: 64_000, cpus: 32 };

  it("sizes by free memory, capped at the default maximum", () => {
    expect(resolveWorkerCount({ ...big })).toBe(MAX_DEFAULT_API_WORKERS);
    expect(resolveWorkerCount({ freeMb: MB_PER_API_WORKER * 3 + 10, cpus: 32 })).toBe(3);
    expect(resolveWorkerCount({ freeMb: MB_PER_API_WORKER * 2, cpus: 32 })).toBe(2);
  });

  it("never goes below one worker, however little memory is free", () => {
    expect(resolveWorkerCount({ freeMb: 0, cpus: 32 })).toBe(1);
    expect(resolveWorkerCount({ freeMb: MB_PER_API_WORKER - 1, cpus: 32 })).toBe(1);
  });

  it("leaves one core for Postgres and the vitest main process", () => {
    expect(resolveWorkerCount({ freeMb: 64_000, cpus: 4 })).toBe(3);
    expect(resolveWorkerCount({ freeMb: 64_000, cpus: 2 })).toBe(1);
    expect(resolveWorkerCount({ freeMb: 64_000, cpus: 1 })).toBe(1);
  });

  it("an explicit override wins over memory and cpu sizing, even above the default cap", () => {
    expect(resolveWorkerCount({ override: "1", ...big })).toBe(1);
    expect(resolveWorkerCount({ override: "7", freeMb: 0, cpus: 1 })).toBe(7);
  });

  it("an empty override is ignored; a malformed one is an error, not a silent fallback", () => {
    expect(resolveWorkerCount({ override: "  ", ...big })).toBe(MAX_DEFAULT_API_WORKERS);
    for (const bad of ["0", "-2", "many"]) {
      expect(() => resolveWorkerCount({ override: bad, ...big })).toThrow(/API_TEST_WORKERS/);
    }
  });
});

describe("worker database names and urls", () => {
  it("withDatabase swaps only the database, keeping server and credentials", () => {
    const u = withDatabase("postgresql://test:test@127.0.0.1:5434/hisaabo_test?sslmode=disable", "hisaabo_test_w1");
    expect(new URL(u).host).toBe("127.0.0.1:5434");
    expect(new URL(u).username).toBe("test");
    expect(new URL(u).password).toBe("test");
    expect(new URL(u).search).toBe("?sslmode=disable");
    expect(databaseNameOf(u)).toBe("hisaabo_test_w1");
  });

  it("each pool slot gets a distinct database under the run's prefix", () => {
    const plan = { template: "hisaabo_test", prefix: "hisaabo_test_wab12cd_" };
    const names = [1, 2, 3, 4].map((k) => workerDbName(plan, k));
    expect(new Set(names).size).toBe(4);
    expect(workerDbName(plan, "2")).toBe("hisaabo_test_wab12cd_2");
    expect(names.every((n) => n.startsWith(`${plan.template}_w`))).toBe(true);
  });
});
