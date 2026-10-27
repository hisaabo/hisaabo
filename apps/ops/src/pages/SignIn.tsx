import { useState, type ReactNode } from "react";
import { api, type Me } from "../api";

export function SignIn({ me, onSignedIn }: { me: Me; onSignedIn: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("session", { code: code.trim() });
      onSignedIn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  let body: ReactNode;
  if (!me.hisaabo) {
    body = (
      <p className="text-sm text-zinc-600">
        Sign in to Hisaabo in this browser first
        {me.appUrl ? (
          <>
            {" "}at <a className="font-medium text-brand-700 underline" href={me.appUrl} rel="noreferrer">{me.appUrl}</a>
          </>
        ) : null}
        , then reload this page.
      </p>
    );
  } else if (!me.operator) {
    body = <p className="text-sm text-zinc-600">{me.hisaabo.email} is not an /ops operator. Operators are added from the server shell with <code className="font-mono">ops operator add</code>.</p>;
  } else if (!me.operator.enrolled) {
    body = <p className="text-sm text-zinc-600">Your authenticator is not enrolled yet. A platform admin enrolls it from the server shell with <code className="font-mono">ops operator enroll {me.operator.email}</code>.</p>;
  } else {
    body = (
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="text-sm text-zinc-600">
          Signed in to Hisaabo as <span className="font-medium">{me.hisaabo.email}</span>. Enter the 6-digit code from your authenticator app, or a recovery code.
        </p>
        <input
          className="input w-full font-mono tracking-widest"
          autoFocus
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="123456"
          aria-label="Authenticator or recovery code"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className="btn btn-primary w-full" disabled={busy || code.trim().length < 6}>
          Continue
        </button>
      </form>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm space-y-4 p-6">
        <div>
          <h1 className="text-lg font-semibold text-brand-700">Hisaabo Ops</h1>
          <p className="text-xs text-zinc-500">Operator access to queues and workers</p>
        </div>
        {body}
      </div>
    </div>
  );
}
