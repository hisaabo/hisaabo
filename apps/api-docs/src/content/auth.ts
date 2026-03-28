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
  ],
};
