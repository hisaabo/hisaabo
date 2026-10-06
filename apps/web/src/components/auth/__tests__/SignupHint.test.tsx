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

  it("has no password or register UI and never calls password auth", () => {
    expect(src).not.toMatch(/type="password"/);
    expect(src).not.toMatch(/auth\.login\b/);
    expect(src).not.toMatch(/auth\.register\b/);
    expect(src).not.toMatch(/Use password/i);
    expect(src).not.toMatch(/Create account/i);
  });

  it("does not skip Turnstile on desktop", () => {
    expect(src).not.toMatch(/action\(undefined\)/);
  });
});
