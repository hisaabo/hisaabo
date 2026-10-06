import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { trpc } from "@/lib/trpc";
import {
  beginDesktopLogin,
  cancelDesktopLogin,
  NativeLoginError,
  type NativeLoginApi,
} from "@/lib/desktop-native-login";
import { SignupHint } from "./SignupHint";

type Status = "idle" | "waiting" | "error";

/** Desktop login: the system browser does the sign-in, the app receives a PKCE-bound code. */
export function DesktopSignIn({ signupOpen }: { signupOpen: boolean | undefined }) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelDesktopLogin();
    };
  }, []);

  async function handleContinue() {
    setError("");
    setStatus("waiting");
    const api: NativeLoginApi = {
      start: (input) => utils.client.auth.nativeStart.mutate(input),
      exchange: (input) => utils.client.auth.nativeExchange.mutate(input),
    };
    try {
      await beginDesktopLogin(api);
      await utils.auth.me.invalidate();
      if (mounted.current) navigate({ to: "/" });
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof NativeLoginError && e.kind === "cancelled") {
        setStatus("idle");
        return;
      }
      setError(
        e instanceof NativeLoginError && e.kind === "timeout"
          ? "Sign-in timed out. Please try again."
          : "Sign-in could not be completed. Please try again.",
      );
      setStatus("error");
    }
  }

  function handleCancel() {
    cancelDesktopLogin();
    setStatus("idle");
  }

  return (
    <div style={{ animation: "form-enter 0.35s ease-out" }}>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-text-primary mb-2" style={{ letterSpacing: "-0.03em" }}>
          Sign in to Hisaabo
        </h1>
        <p className="text-sm text-text-tertiary leading-relaxed">
          Sign-in happens in your browser. When you finish there, you will come back here automatically.
        </p>
      </div>

      {status === "error" && (
        <div role="alert" className="mb-4 px-4 py-3 rounded-xl text-sm bg-red-50 border border-red-200 text-red-700 dark:bg-red-950 dark:border-red-800 dark:text-red-300">
          {error}
        </div>
      )}

      {status === "waiting" ? (
        <div className="space-y-3">
          <p className="text-sm text-text-secondary" role="status">
            Waiting for you to finish signing in in your browser…
          </p>
          <button type="button" onClick={handleCancel} className="btn-ghost w-full py-2.5" style={{ justifyContent: "center" }}>
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleContinue}
          className="btn-primary w-full py-2.5"
          style={{ justifyContent: "center", fontSize: 14, fontWeight: 600 }}
        >
          {status === "error" ? "Try again" : "Continue in browser"}
        </button>
      )}

      <SignupHint signupOpen={signupOpen} />
    </div>
  );
}
