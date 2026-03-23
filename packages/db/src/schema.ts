// Re-export everything from both schemas for backward compatibility.
// Existing imports like `import { users, invoices } from "@hisaabo/db"` continue to work.
export * from "./control-schema.js";
export * from "./tenant-schema.js";
