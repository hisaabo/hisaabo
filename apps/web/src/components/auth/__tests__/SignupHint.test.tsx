import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "fs";
import path from "path";
import { SignupHint } from "../SignupHint";

describe("SignupHint", () => {
  it("offers automatic account creation when sign-up is open", () => {
    render(<SignupHint signupOpen={true} />);
    expect(screen.getByText(/we'll create one automatically/i)).toBeInTheDocument();
  });

  it("states invitation-only when sign-up is closed", () => {
    render(<SignupHint signupOpen={false} />);
    expect(screen.getByText("Sign-in is by invitation on this server.")).toBeInTheDocument();
    expect(screen.queryByText(/create one automatically/i)).toBeNull();
  });

  it("renders nothing until the config has loaded", () => {
    const { container } = render(<SignupHint signupOpen={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("login page source", () => {
  const src = readFileSync(path.resolve(__dirname, "../../../routes/login.tsx"), "utf-8");

  it("has no register UI", () => {
    expect(src).not.toMatch(/auth\.register\b/);
    expect(src).not.toMatch(/Create account/i);
  });

  // Password sign-in is kept on the web (not desktop) so existing accounts and
  // servers without working email can still sign in; the API still supports
  // auth.login. It is offered as a secondary link under the magic-link form.
  it("offers password sign-in only as a secondary option, never on desktop", () => {
    expect(src).toMatch(/auth\.login\b/);
    expect(src).toMatch(/Sign in with password instead/);
    expect(src).toMatch(/!desktop && mode === "password-login"/);
  });

  it("does not skip Turnstile on desktop", () => {
    expect(src).not.toMatch(/action\(undefined\)/);
  });
});
