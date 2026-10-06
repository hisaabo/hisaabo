import type { ReactNode } from "react";
import { TouchableOpacity, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import type { Action, Resource } from "@hisaabo/shared";
import { useCan } from "../hooks/useCan";
import { trpc } from "../lib/trpc";
import { makeStyles } from "../lib/makeStyles";
import { EmptyState } from "./ui";

/**
 * Guards a whole create/edit screen. Action buttons are already hidden from
 * roles without permission, but a screen can still be reached by deep link —
 * in that case show a "no access" state instead of a form the API would reject.
 */
export function PermissionGate({
  action,
  resource,
  children,
}: {
  action: Action;
  resource: Resource;
  children: ReactNode;
}) {
  const allowed = useCan(action, resource);
  const { isLoading } = trpc.auth.me.useQuery(undefined);
  const router = useRouter();
  const styles = useStyles();

  if (allowed) return <>{children}</>;
  // Fail closed while the role is unknown, but don't flash "no access".
  if (isLoading) return <SafeAreaView style={styles.container} />;

  return (
    <SafeAreaView style={styles.container} testID="permission-denied">
      <View style={styles.body}>
        <EmptyState
          icon="lock-closed-outline"
          title="You don't have access to this"
          description="Your role doesn't allow this action. Ask an admin if you need it."
        />
        <TouchableOpacity style={styles.button} onPress={() => router.back()} activeOpacity={0.7}>
          <Text style={styles.buttonText}>Go back</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, justifyContent: "center", alignItems: "center", gap: 16, paddingHorizontal: 32 },
  button: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  buttonText: { color: colors.brand, fontWeight: "600", fontSize: 15 },
}));
