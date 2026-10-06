/** Helper copy under the email form; depends on whether this server accepts new sign-ups. */
export function SignupHint({ signupOpen }: { signupOpen: boolean | undefined }) {
  if (signupOpen === undefined) return null;
  return (
    <p className="text-center text-xs text-text-tertiary mt-4 leading-relaxed">
      {signupOpen
        ? "No account yet? Just enter your email — we'll create one automatically."
        : "Sign-in is by invitation on this server."}
    </p>
  );
}
