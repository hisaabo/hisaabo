import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { trpc, createTRPCClient, queryClient } from "@/lib/trpc";
import { ToastContainer } from "@/components/ui/Toast";
import { routeTree } from "./routeTree.gen";
import { hydrateDesktopSession } from "@/lib/desktop-session";
import { isDesktop } from "@/lib/isDesktop";
import "@/styles/globals.css";

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  context: { trpc: undefined! },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function App() {
  const [trpcClient] = useState(() => createTRPCClient());

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} context={{ trpc }} />
        <ToastContainer />
      </QueryClientProvider>
    </trpc.Provider>
  );
}

// Desktop-only: pull the Bearer token out of the OS keychain before any
// authenticated fetch. If we mounted <App /> first, the initial auth.me
// call would fire without the token and bounce the user to /login despite
// a valid stored session. Web is a no-op — HttpOnly cookies are already
// in the browser's jar.
//
// Also disables the webview's right-click context menu in desktop so the
// browser-style "Share" affordance (which exposes `tauri.localhost/login`
// and can't be spoofed) doesn't show up in a native-feeling app.
async function boot() {
  if (isDesktop()) {
    window.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  await hydrateDesktopSession();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

void boot();
