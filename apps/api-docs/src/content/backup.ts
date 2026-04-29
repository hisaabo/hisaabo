import type { EndpointGroup } from "./types";

export const backupEndpoints: EndpointGroup = {
  id: "backup",
  title: "Backup & Restore",
  description: "Export a full tenant backup as a gzipped tar archive, or restore one into an empty tenant. These are tenant-level operations — they do not require a business to be selected (no x-business-id header needed).",
  endpoints: [
    {
      id: "self-export-request",
      method: "mutation",
      path: "selfExport.request",
      title: "Request Export Token",
      description: "Request a signed, single-use download token for a full tenant backup. The token is valid for 5 minutes. Use the returned URL to stream-download the backup archive (gzipped tar containing NDJSON per table). Rate limited to 2 exports per tenant per 24 hours.",
      auth: "protected",
      input: [
        { name: "tenantId", type: "string (UUID)", required: true, description: "The tenant to export. Caller must be an owner of this tenant." },
      ],
      output: {
        description: "A signed download token and a relative URL. Resolve the URL against your API base (e.g. https://api.hisaabo.in) before downloading.",
        example: {
          token: "eyJhbGciOiJIUzI1NiIs...",
          url: "/api/export/550e8400-e29b-41d4-a716-446655440000?token=eyJhbGci...",
          expiresAt: "2026-04-16T10:05:00.000Z",
        },
      },
      codeExamples: {
        curl: `# Step 1: Get the export token
curl -X POST https://api.hisaabo.in/api/trpc/selfExport.request \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{"json":{"tenantId":"550e8400-e29b-41d4-a716-446655440000"}}'

# Step 2: Download the backup (URL is relative — prefix with API base)
curl -o backup.tar.gz "https://api.hisaabo.in\${RETURNED_URL}"`,
        javascript: `// Step 1: Request token
const { url } = await trpc.selfExport.request.mutate({
  tenantId: "550e8400-e29b-41d4-a716-446655440000",
});

// Step 2: Download the backup. The URL is relative — resolve against your API base.
const response = await fetch(\`https://api.hisaabo.in\${url}\`);
const blob = await response.blob();
// Save blob to file...`,
      },
      gotchas: [
        "Rate limited to 2 exports per tenant per 24 hours.",
        "Caller must be an owner of the target tenant.",
        "Token expires in 5 minutes — download must start before then.",
        "No x-business-id header required — this is a tenant-level operation.",
      ],
      relatedEndpoints: ["self-import-request"],
    },
    {
      id: "self-import-request",
      method: "mutation",
      path: "selfImport.request",
      title: "Request Import Token",
      description: "Request a signed upload token for restoring a backup into an empty tenant. The token is valid for 15 minutes. The target tenant must have zero businesses — the server enforces this at both token issuance and upload time. Use the returned URL to POST the gzipped tar archive.",
      auth: "protected",
      input: [
        { name: "tenantId", type: "string (UUID)", required: true, description: "The target tenant to import into. Must be empty (no businesses). Caller must be an owner." },
      ],
      output: {
        description: "A signed upload token and URL.",
        example: {
          token: "eyJhbGciOiJIUzI1NiIs...",
          url: "/api/selfImport/550e8400-e29b-41d4-a716-446655440000?token=eyJhbGci...",
          expiresAt: "2026-04-16T10:15:00.000Z",
        },
      },
      codeExamples: {
        curl: `# Step 1: Get the import token
curl -X POST https://api.hisaabo.in/api/trpc/selfImport.request \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{"json":{"tenantId":"550e8400-e29b-41d4-a716-446655440000"}}'

# Step 2: Upload the backup archive
curl -X POST "https://api.hisaabo.in/api/selfImport/TENANT_ID?token=RETURNED_TOKEN" \\
  -H "Content-Type: application/gzip" \\
  --data-binary @backup.tar.gz`,
        javascript: `// Step 1: Request token
const { url } = await trpc.selfImport.request.mutate({
  tenantId: "550e8400-e29b-41d4-a716-446655440000",
});

// Step 2: Upload the backup
const file = await fs.readFile("backup.tar.gz");
const response = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/gzip" },
  body: file,
});
const result = await response.json();
console.log(\`Imported \${result.rowsInserted} rows in \${result.durationMs}ms\`);`,
      },
      gotchas: [
        "Target tenant must be completely empty (zero businesses).",
        "Token expires in 15 minutes.",
        "Upload body must be Content-Type: application/gzip — raw gzip, not multipart.",
        "Empty-target check runs again at upload time, preventing TOCTOU races.",
        "No x-business-id header required — this is a tenant-level operation.",
        "On success, the response includes rowsInserted, rowsSkipped, warnings, and durationMs.",
      ],
      relatedEndpoints: ["self-export-request"],
    },
  ],
};
