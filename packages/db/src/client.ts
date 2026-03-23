// Backward-compatibility shim.
// Re-exports controlDb as the default `db` so existing code that imports
// `{ db }` from "@hisaabo/db" or "./client.js" continues to work unchanged.
// In self-hosted mode this is the same DB as tenant data.
// In routers, prefer using ctx.db (tenant-scoped) instead of this import.
export { controlDb as db, type ControlDatabase as Database } from "./control-client.js";
