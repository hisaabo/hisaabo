import { View, Text, ScrollView, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles } from "../../../../src/lib/makeStyles";
import { useColors } from "../../../../src/contexts/ThemeContext";
import { useTheme, type ThemeMode } from "../../../../src/contexts/ThemeContext";
import { haptic } from "../../../../src/lib/haptics";

type Option = {
  value: ThemeMode;
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const OPTIONS: Option[] = [
  { value: "system", label: "Match system", description: "Follows your device's light/dark setting", icon: "phone-portrait-outline" },
  { value: "light", label: "Light", description: "Always use the light theme", icon: "sunny-outline" },
  { value: "dark", label: "Dark", description: "Always use the dark theme", icon: "moon-outline" },
];

export default function AppearanceScreen() {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const { mode, setMode } = useTheme();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Appearance</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionHint}>
          Choose how Hisaabo looks on this device.
        </Text>

        <View style={styles.list}>
          {OPTIONS.map((opt, idx) => {
            const selected = mode === opt.value;
            const isLast = idx === OPTIONS.length - 1;
            return (
              <TouchableOpacity
                key={opt.value}
                activeOpacity={0.7}
                onPress={() => {
                  haptic.light();
                  setMode(opt.value);
                }}
                style={[styles.row, !isLast && styles.rowBorder]}
              >
                <View
                  style={[
                    styles.iconWrap,
                    { backgroundColor: selected ? colors.brandLight : colors.surfaceHover },
                  ]}
                >
                  <Ionicons
                    name={opt.icon}
                    size={20}
                    color={selected ? colors.brand : colors.textSecondary}
                  />
                </View>
                <View style={styles.textWrap}>
                  <Text style={styles.label}>{opt.label}</Text>
                  <Text style={styles.description}>{opt.description}</Text>
                </View>
                {selected ? (
                  <Ionicons name="checkmark-circle" size={22} color={colors.brand} />
                ) : (
                  <View style={styles.radio} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "700", color: colors.textPrimary },
  content: { padding: 16, paddingBottom: 48 },
  sectionHint: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 12,
    lineHeight: 18,
  },
  list: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  textWrap: { flex: 1 },
  label: { fontSize: 15, fontWeight: "600", color: colors.textPrimary },
  description: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
  },
}));
