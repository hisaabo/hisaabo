import type { EndpointGroup } from "./types";

export const apiKeyEndpoints: EndpointGroup = {
  id: "api-keys",
  title: "API Keys",
  description: "Create and manage API keys for programmatic access. API keys authenticate server-to-server calls and MCP agent connections without sharing user credentials.",
  endpoints: [
    {
      id: "apikey-list",
      method: "query",
      path: "apiKey.list",
      title: "List API Keys",
      description: "List all API keys for the current user within the selected organization. Returns display-safe metadata only — never exposes the full key or its hash. Shows the key prefix (first 20 chars) for identification, along with usage and expiry info.",
      auth: "protected",
      input: [],
      output: {
        description: "Array of API key metadata. The full key is never returned after creation.",
        example: [
          {
            id: "key-uuid-1",
            name: "MCP Agent — Production",
            keyPrefix: "hisaabo_key_abc12345",
            lastUsedAt: "2026-04-08T09:15:00.000Z",
            expiresAt: "2026-07-08T00:00:00.000Z",
            createdAt: "2026-04-01T10:00:00.000Z",
          },
          {
            id: "key-uuid-2",
            name: "CI/CD Pipeline",
            keyPrefix: "hisaabo_key_xyz98765",
            lastUsedAt: null,
            expiresAt: null,
            createdAt: "2026-04-05T14:30:00.000Z",
          },
        ],
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/apiKey.list" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"`,
        javascript: `const keys = await trpc.apiKey.list.query();
for (const key of keys) {
  console.log(\`\${key.name} (\${key.keyPrefix}...) — last used: \${key.lastUsedAt ?? "never"}\`);
}`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/apiKey.list",
    headers={"Authorization": f"Bearer {session_token}"},
)
keys = resp.json()["result"]["data"]["json"]
for key in keys:
    print(f"{key['name']} ({key['keyPrefix']}...)")`,
      },
      gotchas: [
        "Requires a selected organization in the session — returns BAD_REQUEST if no organization is selected.",
        "The full API key is only shown once at creation time. After that, only the `keyPrefix` (first 20 chars) is available for identification.",
        "Keys are scoped to user + organization. Switching organizations shows different keys.",
      ],
    },
    {
      id: "apikey-create",
      method: "mutation",
      path: "apiKey.create",
      title: "Create API Key",
      description: "Generate a new API key for programmatic access. The raw key is returned exactly once in the response — it is never stored or retrievable again. The key is hashed with SHA-256 before storage. Enforces plan-level limits on the number of keys per organization.",
      auth: "protected",
      input: [
        { name: "name", type: "string", required: true, description: "Human-readable name for the key (1-100 chars). e.g. 'MCP Agent — Production'" },
        { name: "expiresAt", type: "string (ISO 8601)", required: false, description: "Optional expiry date. If omitted, the key never expires." },
      ],
      output: {
        description: "The created key metadata including the raw key. IMPORTANT: The `key` field is only shown once.",
        example: {
          id: "key-uuid",
          name: "MCP Agent — Production",
          key: "hisaabo_key_abc123def456ghi789jkl012mno345pqrst678",
          keyPrefix: "hisaabo_key_abc12345",
          expiresAt: "2026-07-08T00:00:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/apiKey.create \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{"name":"MCP Agent — Production","expiresAt":"2026-07-08T00:00:00.000Z"}}'`,
        javascript: `const result = await trpc.apiKey.create.mutate({
  name: "MCP Agent — Production",
  expiresAt: "2026-07-08T00:00:00.000Z",
});

// IMPORTANT: Store this key securely — it won't be shown again!
console.log("API Key:", result.key);
console.log("Save this key — it cannot be retrieved later.");`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/apiKey.create",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {
        "name": "MCP Agent — Production",
        "expiresAt": "2026-07-08T00:00:00.000Z",
    }},
)
data = resp.json()["result"]["data"]["json"]
# IMPORTANT: Store this key securely — it won't be shown again!
print("API Key:", data["key"])`,
      },
      gotchas: [
        "The raw `key` is returned ONLY in this response. It is hashed (SHA-256) before storage and cannot be retrieved again. Store it securely.",
        "Requires a selected organization — returns BAD_REQUEST if none is selected.",
        "Blocked on free-tier organizations. Returns FORBIDDEN with a plan upgrade message if the limit is exceeded.",
        "Key format: `hisaabo_key_` followed by 43 base64url characters (32 random bytes).",
        "The `keyPrefix` (first 20 chars) is stored for display identification in the key list.",
        "If `expiresAt` is omitted, the key never expires. Set an expiry for production keys as a security best practice.",
      ],
      relatedEndpoints: ["apikey-list", "apikey-revoke"],
    },
    {
      id: "apikey-revoke",
      method: "mutation",
      path: "apiKey.revoke",
      title: "Revoke API Key",
      description: "Permanently delete an API key. The key immediately stops working for all API calls. Verifies that the key belongs to the current user and organization before deletion.",
      auth: "protected",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "The API key ID to revoke" },
      ],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/apiKey.revoke \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{"id":"key-uuid"}}'`,
        javascript: `await trpc.apiKey.revoke.mutate({ id: "key-uuid" });
// Key is immediately invalid — all requests using it will fail`,
        python: `import httpx

httpx.post(
    "https://api.hisaabo.in/api/trpc/apiKey.revoke",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {"id": "key-uuid"}},
)`,
      },
      gotchas: [
        "Returns NOT_FOUND if the key doesn't exist or belongs to a different user/organization.",
        "Revocation is immediate and permanent — there is no way to un-revoke a key.",
        "Any in-flight API requests using the revoked key will fail on their next authentication check.",
        "Requires a selected organization — returns BAD_REQUEST if none is selected.",
      ],
      relatedEndpoints: ["apikey-list", "apikey-create"],
    },
  ],
};
