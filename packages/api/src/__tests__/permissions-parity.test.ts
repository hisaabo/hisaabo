import { describe, it, expect } from "vitest";
import { defineAbilityFor as defineApiAbility, mapDbRole as mapApiDbRole } from "../lib/permissions.js";
import {
  defineAbilityFor as defineSharedAbility,
  mapDbRole as mapSharedDbRole,
  ALL_ACTIONS,
  ALL_RESOURCES,
  type Action,
  type Resource,
} from "@hisaabo/shared";

// The API enforces permissions via CASL (server-side authority). The shared
// module mirrors the same matrix for the front-end without pulling CASL into
// client bundles. These tests ensure the two cannot drift.

const ALL_ROLES = [
  "superadmin",
  "admin",
  "seller_manager",
  "seller",
  "accountant",
  // Legacy DB values that map via mapDbRole
  "owner",
  "member",
  "viewer",
  // Unknown — both modules must produce zero grants
  "garbage_role",
];

describe("permission parity: shared vs API CASL", () => {
  it("mapDbRole agrees for every known input", () => {
    for (const role of ALL_ROLES) {
      // API mapDbRole returns "" for unknown; shared returns "" (cast as RoleName | "").
      expect(mapSharedDbRole(role)).toBe(mapApiDbRole(role));
    }
  });

  // For each role, walk every (action, resource) cell and assert both
  // abilities give the same yes/no answer.
  for (const role of ALL_ROLES) {
    describe(`role=${role}`, () => {
      const sharedAbility = defineSharedAbility(role);
      const apiAbility = defineApiAbility({ userId: "test-user", role: mapApiDbRole(role) });

      for (const resource of ALL_RESOURCES) {
        for (const action of ALL_ACTIONS) {
          it(`${action}:${resource}`, () => {
            const shared = sharedAbility.can(action, resource);
            const api = apiAbility.can(action, resource);
            expect(shared).toBe(api);
          });
        }
      }
    });
  }
});
