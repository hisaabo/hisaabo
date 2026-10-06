import { createFileRoute } from "@tanstack/react-router";
import { NativeAuthPage } from "@/components/auth/NativeAuthPage";

export const Route = createFileRoute("/auth/native")({
  component: NativeAuthPage,
});
