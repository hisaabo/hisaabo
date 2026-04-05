import { QueryClient, QueryCache } from "@tanstack/react-query";
import * as SecureStore from "expo-secure-store";
import { useAuthStore } from "../stores/auth";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      retry: (failureCount, error) => {
        const trpcError = error as any;
        if (trpcError?.data?.code === "UNAUTHORIZED") return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
    },
  },
  queryCache: new QueryCache({
    onError: (error, query) => {
      const trpcError = error as any;
      if (__DEV__) {
        console.warn("[QueryCache error]", {
          queryKey: query.queryKey,
          code: trpcError?.data?.code,
          message: trpcError?.message,
          httpStatus: trpcError?.data?.httpStatus,
        });
      }
      if (trpcError?.data?.code === "UNAUTHORIZED") {
        SecureStore.setItemAsync("sessionExpired", "1");
        useAuthStore.getState().logout();
      }
    },
  }),
});
