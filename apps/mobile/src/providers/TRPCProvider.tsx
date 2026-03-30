import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { trpc, createTRPCClient } from "../lib/trpc";
import { queryClient } from "../lib/query-client";

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => createTRPCClient());
  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
