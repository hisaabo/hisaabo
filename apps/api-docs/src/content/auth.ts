import type { EndpointGroup } from "./types";

export const authEndpoints: EndpointGroup = {
  id: "auth",
  title: "Authentication",
  description: "Authenticate users via email/password or magic link. Sessions last 30 days and are stored as HttpOnly cookies. Mobile clients can use the returned sessionToken as a Bearer token.",
  endpoints: [
    {
      id: "auth-register",
      method: "mutation",
      path: "auth.register",
      title: "Register",
      description: "Create a new account with email, name, and password. On self-hosted deployments, the first user to register gets the `owner` role on the default organization. Subsequent users get `member`. In multi-tenant mode (`MULTI_TENANT=true`), each user gets their own organization.",
      auth: "public",
      input: [
        { name: "email", type: "string", required: true, description: "Valid email address (max 255 chars)" },
        { name: "name", type: "string", required: true, description: "Display name (2–100 chars)" },
        { name: "password", type: "string", required: true, description: "Password (8–128 chars)" },
        { name: "confirmPassword", type: "string", required: true, description: "Must match `password`" },
      ],
      output: {
        description: "Authenticated user object and session token. An HttpOnly `session_id` cookie is also set automatically.",
        example: {
          user: { id: "01957a2b-3c4d-7e8f-9012-abcdef012345", email: "rahul@myshop.in", name: "Rahul Sharma" },
          sessionToken: "sess_VbK2mQ9xP4nR7wA1...",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/auth.register \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"email":"rahul@myshop.in","name":"Rahul Sharma","password":"strongpass123","confirmPassword":"strongpass123"}}'`,
        javascript: `const result = await trpc.auth.register.mutate({
  email: "rahul@myshop.in",
  name: "Rahul Sharma",
  password: "strongpass123",
  confirmPassword: "strongpass123",
});
// Store result.sessionToken for mobile Bearer auth
// Web clients: cookie is set automatically`,
        python: `import httpx, json

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/auth.register",
    json={"json": {
        "email": "rahul@myshop.in",
        "name": "Rahul Sharma",
        "password": "strongpass123",
        "confirmPassword": "strongpass123",
    }},
)
data = resp.json()["result"]["data"]["json"]
session_token = data["sessionToken"]`,
      },
      gotchas: [
        "Returns CONFLICT (409) if the email is already registered.",
        "Password is hashed with Argon2id (memoryCost=65536, timeCost=3, parallelism=4) — never stored in plaintext.",
        "The `sessionToken` in the response is for mobile clients. Web clients should use the `session_id` HttpOnly cookie set automatically.",
      ],
    },
    {
      id: "auth-login",
      method: "mutation",
      path: "auth.login",
      title: "Login with Password",
      description: "Authenticate with email and password. Returns a session token for mobile clients and sets an HttpOnly `session_id` cookie for web clients. Both auth mechanisms can be used simultaneously.",
      auth: "public",
      input: [
        { name: "email", type: "string", required: true, description: "Registered email address (max 255 chars)" },
        { name: "password", type: "string", required: true, description: "Account password (8–128 chars)" },
      ],
      output: {
        description: "Authenticated user object with session token.",
        example: {
          user: { id: "01957a2b-3c4d-7e8f-9012-abcdef012345", email: "rahul@myshop.in", name: "Rahul Sharma" },
          sessionToken: "sess_VbK2mQ9xP4nR7wA1...",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/auth.login \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"email":"rahul@myshop.in","password":"strongpass123"}}'`,
        javascript: `const result = await trpc.auth.login.mutate({
  email: "rahul@myshop.in",
  password: "strongpass123",
});
// result.sessionToken — store this for mobile auth
// Cookie is set automatically for web clients`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/auth.login",
    json={"json": {"email": "rahul@myshop.in", "password": "strongpass123"}},
)
data = resp.json()["result"]["data"]["json"]
session_token = data["sessionToken"]`,
      },
      gotchas: [
        "Returns a generic 'Invalid email or password' for both wrong email and wrong password — this prevents email enumeration attacks.",
        "Returns FORBIDDEN (403) if the account exists but has no organization membership.",
        "The `sessionToken` in the response body is for mobile clients. Web clients should use the HttpOnly cookie set automatically.",
      ],
    },
    {
      id: "auth-send-magic-link",
      method: "mutation",
      path: "auth.sendMagicLink",
      title: "Send Magic Link",
      description: "Send a passwordless sign-in link to an email address. If the email is not registered, a new account is created automatically when the link is clicked. Always returns `{success: true}` regardless of whether the email exists, preventing email enumeration.",
      auth: "public",
      input: [
        { name: "email", type: "string", required: true, description: "Email address to send the magic link to (max 255 chars)" },
      ],
      output: {
        description: "Always returns success to prevent email enumeration.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/auth.sendMagicLink \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"email":"rahul@myshop.in"}}'`,
        javascript: `await trpc.auth.sendMagicLink.mutate({
  email: "rahul@myshop.in",
});
// Ask user to check their inbox for the sign-in link`,
        python: `import httpx

httpx.post(
    "https://api.hisaabo.in/api/trpc/auth.sendMagicLink",
    json={"json": {"email": "rahul@myshop.in"}},
)`,
      },
      gotchas: [
        "Rate limited: 5 requests per email per 15 minutes. Excess requests silently succeed (no rate-limit error exposed).",
        "The link expires in 15 minutes and can only be used once (atomically marked used on verify).",
        "If `RESEND_API_KEY` is not configured, the magic link is printed to the server console (development mode).",
        "New users who verify the link will have `needsProfile: true` — redirect them to complete their profile.",
      ],
    },
    {
      id: "auth-verify-magic-link",
      method: "mutation",
      path: "auth.verifyMagicLink",
      title: "Verify Magic Link",
      description: "Exchange a magic link token for an authenticated session. The token is atomically marked as used in a single UPDATE statement to prevent race-condition double-use. If the email is new, an account and organization are created automatically.",
      auth: "public",
      input: [
        { name: "token", type: "string", required: true, description: "The token from the magic link URL (1–128 chars)" },
      ],
      output: {
        description: "Authenticated user with session token and profile completion flag.",
        example: {
          user: { id: "01957a2b-3c4d-7e8f-9012-abcdef012345", email: "rahul@myshop.in", name: null },
          sessionToken: "sess_VbK2mQ9xP4nR7wA1...",
          isNewUser: true,
          needsProfile: true,
        },
      },
      codeExamples: {
        curl: `# Token comes from the ?token= param of the magic link URL
curl -X POST https://api.hisaabo.in/api/trpc/auth.verifyMagicLink \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"token":"<token-from-email-link>"}}'`,
        javascript: `// Extract token from URL: /auth/verify?token=abc123...
const url = new URL(window.location.href);
const token = url.searchParams.get("token");

const result = await trpc.auth.verifyMagicLink.mutate({ token });

if (result.needsProfile) {
  // Redirect to profile completion page
  navigate("/auth/complete-profile");
}`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/auth.verifyMagicLink",
    json={"json": {"token": token_from_email}},
)
data = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Returns BAD_REQUEST if the token is invalid, expired (>15 min), or already used.",
        "Token verification is atomic — concurrent requests with the same token will see one succeed and one fail.",
        "Check `needsProfile` in the response. If true, the user has no display name yet — prompt them to set one via `auth.completeProfile`.",
      ],
      relatedEndpoints: ["auth-send-magic-link", "auth-complete-profile"],
    },
    {
      id: "auth-complete-profile",
      method: "mutation",
      path: "auth.completeProfile",
      title: "Complete Profile",
      description: "Set the display name for a user who signed in via magic link for the first time. After calling this, `auth.me` will return `needsProfile: false`.",
      auth: "protected",
      input: [
        { name: "name", type: "string", required: true, description: "Display name (2–100 chars)" },
      ],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/auth.completeProfile \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{"name":"Rahul Sharma"}}'`,
        javascript: `await trpc.auth.completeProfile.mutate({ name: "Rahul Sharma" });
// Session cache is invalidated — next auth.me call returns updated name`,
        python: `import httpx

httpx.post(
    "https://api.hisaabo.in/api/trpc/auth.completeProfile",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {"name": "Rahul Sharma"}},
)`,
      },
    },
    {
      id: "auth-me",
      method: "query",
      path: "auth.me",
      title: "Get Current User",
      description: "Returns the currently authenticated user's profile, organization ID, organization name, and role. Returns null fields if not authenticated. Results are cached in-process for performance.",
      auth: "public",
      input: [],
      output: {
        description: "Current session information. All fields are null when not authenticated.",
        example: {
          user: { id: "01957a2b-3c4d-7e8f-9012-abcdef012345", email: "rahul@myshop.in", name: "Rahul Sharma" },
          tenantId: "tenant-uuid",
          tenantName: "Rahul's Organization",
          role: "owner",
          needsProfile: false,
        },
      },
      codeExamples: {
        curl: `curl https://api.hisaabo.in/api/trpc/auth.me \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"`,
        javascript: `const session = await trpc.auth.me.query();

if (session.user) {
  console.log("Logged in as", session.user.name);
  console.log("Organization:", session.tenantName);
  console.log("Role:", session.role); // "owner" | "admin" | "member" | ...
}`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/auth.me",
    headers={"Authorization": f"Bearer {session_token}"},
)
session = resp.json()["result"]["data"]["json"]
if session["user"]:
    print("Logged in as", session["user"]["name"])`,
      },
      gotchas: [
        "This is a `query` (GET) — not a mutation. Use `.query()` not `.mutate()`.",
        "When unauthenticated, returns `{user: null, tenantId: null, tenantName: null, role: null, needsProfile: false}` — it does NOT throw.",
      ],
    },
    {
      id: "auth-logout",
      method: "mutation",
      path: "auth.logout",
      title: "Logout",
      description: "Invalidate the current session. Deletes the session from the database, clears the in-process session cache, and clears the `session_id` cookie.",
      auth: "protected",
      input: [],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/auth.logout \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{}'`,
        javascript: `await trpc.auth.logout.mutate();
// Cookie is cleared automatically
// Redirect to login page`,
        python: `httpx.post(
    "https://api.hisaabo.in/api/trpc/auth.logout",
    headers={"Authorization": f"Bearer {session_token}"},
    json={},
)`,
      },
      relatedEndpoints: ["auth-logout-all"],
    },
    {
      id: "auth-logout-all",
      method: "mutation",
      path: "auth.logoutAll",
      title: "Logout All Sessions",
      description: "Invalidate all sessions for the current user across all devices. Useful for security incident response.",
      auth: "protected",
      input: [],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/auth.logoutAll \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{}'`,
        javascript: `await trpc.auth.logoutAll.mutate();
// All sessions across all devices are now invalid`,
        python: `httpx.post(
    "https://api.hisaabo.in/api/trpc/auth.logoutAll",
    headers={"Authorization": f"Bearer {session_token}"},
    json={},
)`,
      },
    },
    {
      id: "auth-update-name",
      method: "mutation",
      path: "auth.updateName",
      title: "Update Name",
      description: "Change the display name of the currently authenticated user. Invalidates the session cache so subsequent `auth.me` calls return the updated name.",
      auth: "protected",
      input: [
        { name: "name", type: "string", required: true, description: "New display name (2\u2013100 chars)" },
      ],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/auth.updateName \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{"name":"Rahul Kumar Sharma"}}'`,
        javascript: `await trpc.auth.updateName.mutate({ name: "Rahul Kumar Sharma" });
// Session cache is invalidated \u2014 next auth.me call returns updated name`,
        python: `import httpx

httpx.post(
    "https://api.hisaabo.in/api/trpc/auth.updateName",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {"name": "Rahul Kumar Sharma"}},
)`,
      },
      relatedEndpoints: ["auth-me", "auth-complete-profile"],
    },
    {
      id: "auth-request-email-change",
      method: "mutation",
      path: "auth.requestEmailChange",
      title: "Request Email Change",
      description: "Initiate an email address change. Sends a verification link to the new email. The change is not applied until the link is clicked (see `auth.confirmEmailChange`). Returns CONFLICT if the new email is already registered.",
      auth: "protected",
      input: [
        { name: "newEmail", type: "string", required: true, description: "New email address (max 255 chars)" },
      ],
      output: {
        description: "Success confirmation. The verification link is sent to the new email.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/auth.requestEmailChange \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{"newEmail":"rahul.new@myshop.in"}}'`,
        javascript: `await trpc.auth.requestEmailChange.mutate({
  newEmail: "rahul.new@myshop.in",
});
// Ask user to check new email inbox for verification link`,
        python: `import httpx

httpx.post(
    "https://api.hisaabo.in/api/trpc/auth.requestEmailChange",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {"newEmail": "rahul.new@myshop.in"}},
)`,
      },
      gotchas: [
        "Returns CONFLICT (409) if the new email is already registered to another account.",
        "The verification link expires in 15 minutes and can only be used once.",
        "The requesting user's ID is bound server-side to the token \u2014 clients cannot substitute a different userId.",
      ],
      relatedEndpoints: ["auth-confirm-email-change"],
    },
    {
      id: "auth-confirm-email-change",
      method: "mutation",
      path: "auth.confirmEmailChange",
      title: "Confirm Email Change",
      description: "Exchange the email-change verification token to apply the new email. The token contains the bound userId server-side \u2014 no userId is accepted from client input, preventing account takeover. This is a public endpoint because the user may verify from a different device.",
      auth: "public",
      input: [
        { name: "token", type: "string", required: true, description: "Token from the email verification link" },
      ],
      output: {
        description: "Success confirmation with the new email address.",
        example: { success: true, newEmail: "rahul.new@myshop.in" },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/auth.confirmEmailChange \\
  -H "Content-Type: application/json" \\
  -d '{"json":{"token":"<token-from-verification-link>"}}'`,
        javascript: `const url = new URL(window.location.href);
const token = url.searchParams.get("token");

const result = await trpc.auth.confirmEmailChange.mutate({ token });
console.log("Email changed to:", result.newEmail);`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/auth.confirmEmailChange",
    json={"json": {"token": token_from_email}},
)
data = resp.json()["result"]["data"]["json"]
print("New email:", data["newEmail"])`,
      },
      gotchas: [
        "Returns BAD_REQUEST if the token is invalid, expired (>15 min), or already used.",
        "The userId is read from the token record server-side \u2014 never from client input. This prevents token substitution attacks.",
        "Token verification is atomic \u2014 concurrent requests with the same token will see one succeed and one fail.",
      ],
      relatedEndpoints: ["auth-request-email-change"],
    },
    {
      id: "auth-list-sessions",
      method: "query",
      path: "auth.listSessions",
      title: "List Sessions",
      description: "List all active (or expired) sessions for the current user. Each session includes IP address, user agent, creation time, last-used time, and whether it is the current session. Useful for building a \"manage sessions\" security page.",
      auth: "protected",
      input: [
        { name: "expired", type: "boolean", required: false, description: "If true, return expired sessions instead of active ones.", default: "false" },
      ],
      output: {
        description: "Array of session objects with `isCurrent` flag.",
        example: [
          {
            id: "sess_abc123...",
            ipAddress: "103.21.244.15",
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...",
            createdAt: "2026-03-15T08:30:00.000Z",
            lastUsedAt: "2026-04-08T10:00:00.000Z",
            expiresAt: "2026-04-14T08:30:00.000Z",
            isCurrent: true,
          },
          {
            id: "sess_def456...",
            ipAddress: "49.36.128.42",
            userAgent: "Hisaabo-Mobile/1.0",
            createdAt: "2026-04-01T12:00:00.000Z",
            lastUsedAt: "2026-04-07T18:00:00.000Z",
            expiresAt: "2026-05-01T12:00:00.000Z",
            isCurrent: false,
          },
        ],
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/auth.listSessions?input=%7B%22json%22%3A%7B%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"`,
        javascript: `const sessions = await trpc.auth.listSessions.query();
const current = sessions.find(s => s.isCurrent);
const others = sessions.filter(s => !s.isCurrent);
console.log("Active sessions:", sessions.length);`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/auth.listSessions?input={params}",
    headers={"Authorization": f"Bearer {session_token}"},
)
sessions = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "This is a `query` (GET) \u2014 use `.query()` not `.mutate()`.",
        "The `isCurrent` flag is always `false` when querying expired sessions.",
        "Sessions are ordered by creation date descending (newest first).",
      ],
      relatedEndpoints: ["auth-revoke-session", "auth-logout-all"],
    },
    {
      id: "auth-revoke-session",
      method: "mutation",
      path: "auth.revokeSession",
      title: "Revoke Session",
      description: "Invalidate a specific session by ID. Cannot be used to revoke the current session \u2014 use `auth.logout` instead. Only sessions belonging to the current user can be revoked.",
      auth: "protected",
      input: [
        { name: "sessionId", type: "string", required: true, description: "ID of the session to revoke (min 1 char)" },
      ],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/auth.revokeSession \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{"sessionId":"sess_def456..."}}'`,
        javascript: `await trpc.auth.revokeSession.mutate({
  sessionId: "sess_def456...",
});
// The target session is now invalid \u2014 that device is logged out`,
        python: `import httpx

httpx.post(
    "https://api.hisaabo.in/api/trpc/auth.revokeSession",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {"sessionId": "sess_def456..."}},
)`,
      },
      gotchas: [
        "Returns BAD_REQUEST if you try to revoke your own current session. Use `auth.logout` instead.",
        "Returns NOT_FOUND if the session ID does not exist or belongs to a different user.",
        "The session cache is invalidated immediately \u2014 the revoked session will fail on the next API call.",
      ],
      relatedEndpoints: ["auth-list-sessions", "auth-logout"],
    },
  ],
};
