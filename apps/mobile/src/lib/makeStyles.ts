import { useMemo } from "react";
import { StyleSheet } from "react-native";
import { useColors } from "../contexts/ThemeContext";
import type { Colors } from "./theme";

/**
 * Build a theme-aware StyleSheet. Returns a hook so styles recompute whenever
 * the active palette changes.
 *
 *   const useStyles = makeStyles((colors) => ({
 *     container: { backgroundColor: colors.bg },
 *   }));
 *
 *   function Screen() {
 *     const styles = useStyles();
 *     return <View style={styles.container} />;
 *   }
 */
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (colors: Colors) => T,
): () => T {
  return function useStyles(): T {
    const colors = useColors();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}
