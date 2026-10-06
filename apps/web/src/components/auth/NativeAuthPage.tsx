import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { trpc } from "@/lib/trpc";
import { Logo } from "@/components/ui/Logo";
import {
  clearNativeRequest,
  isSafeNativeRedirect,
  nativeRequestFromUrl,
  peekNativeRequest,
  stashNativeRequest,
} from "@/lib/native-login";

const CLIENT_LABEL: Record<string, string> = {
  desktop: "Desktop",
  mobile: "Mobile",
  cli: "CLI",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-surface-1">
      <div className="w-full max-w-[380px] rounded-2xl p-8 shadow-elevated bg-surface-0 border border-border-light text-center">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <Logo className="w-9 h-9" />
          <span className="font-semibold text-lg tracking-tight text-text-primary">Hisaabo</span>
        </div>
        {children}
      </div>
    </div>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <>
      <h1 className="text-lg font-semibold text-text-primary mb-2">{title}</h1>
      <p className="text-sm text-text-tertiary">{body}</p>
    </>
  );
}

type View = "consent" | "redirecting" | "cancelled" | "invalid";

/** Consent screen for `/auth/native?request=<id>`: lets a signed-in user approve a native app sign-in. */
export function NativeAuthPage() {
  const navigate = useNavigate();
  const [requestId] = useState<string | null>(() => {
    const fromUrl = nativeRequestFromUrl(window.location.search);
    if (fromUrl) {
      stashNativeRequest(fromUrl);
      window.history.replaceState({}, "", "/auth/native");
      return fromUrl;
    }
    return peekNativeRequest();
  });
  const [view, setView] = useState<View>("consent");

  const { data: session, isLoading: sessionLoading } = trpc.auth.me.useQuery();
  const info = trpc.auth.nativeRequestInfo.useQuery(
    { requestId: requestId ?? "" },
    { enabled: !!requestId, retry: false },
  );
  const authorize = trpc.auth.nativeAuthorize.useMutation({
    onSuccess: ({ redirectUrl }) => {
      clearNativeRequest();
      if (!isSafeNativeRedirect(redirectUrl)) {
        setView("invalid");
        return;
      }
      setView("redirecting");
      window.location.replace(redirectUrl);
    },
    onError: () => {
      clearNativeRequest();
      setView("invalid");
    },
  });

  const signedIn = !!session?.user;
  const needsLogin = !sessionLoading && !signedIn && !!requestId && !info.isError;

  useEffect(() => {
    if (needsLogin && requestId) {
      stashNativeRequest(requestId);
      navigate({ to: "/login" });
    }
  }, [needsLogin, requestId, navigate]);

  if (!requestId || info.isError || view === "invalid") {
    if (info.isError) clearNativeRequest();
    return (
      <Shell>
        <Message
          title="Sign-in request expired"
          body="This sign-in request is no longer valid. Go back to the Hisaabo app and start signing in again."
        />
      </Shell>
    );
  }

  if (view === "cancelled") {
    return (
      <Shell>
        <Message title="Sign-in cancelled" body="You can close this tab." />
      </Shell>
    );
  }

  if (view === "redirecting") {
    return (
      <Shell>
        <Message
          title="You're signed in"
          body="You can close this tab and return to Hisaabo."
        />
      </Shell>
    );
  }

  if (sessionLoading || info.isLoading || needsLogin || !info.data) {
    return (
      <Shell>
        <p className="text-sm text-text-tertiary" role="status">Loading…</p>
      </Shell>
    );
  }

  const label = CLIENT_LABEL[info.data.client] ?? "App";
  return (
    <Shell>
      <h1 className="text-lg font-semibold text-text-primary mb-2">
        Sign in to Hisaabo {label} as {session?.user?.email}?
      </h1>
      <p className="text-sm text-text-tertiary mb-6">
        Only continue if you just started signing in from the Hisaabo {label} app.
      </p>
      <button
        type="button"
        onClick={() => authorize.mutate({ requestId })}
        disabled={authorize.isPending}
        className="btn-primary w-full py-2.5 mb-3"
        style={{ justifyContent: "center" }}
      >
        {authorize.isPending ? "Continuing…" : "Continue"}
      </button>
      <button
        type="button"
        onClick={() => {
          clearNativeRequest();
          setView("cancelled");
        }}
        className="text-sm text-text-tertiary hover:text-text-primary underline underline-offset-2"
      >
        Cancel
      </button>
    </Shell>
  );
}
