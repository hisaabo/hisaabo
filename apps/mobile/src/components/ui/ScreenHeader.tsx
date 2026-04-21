import { View, Text } from "react-native";
import { makeStyles } from "../../lib/makeStyles";

interface Props {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}

export function ScreenHeader({ title, subtitle, right }: Props) {
  const styles = useStyles();
  return (
    <View style={styles.container}>
      <View style={styles.textWrap}>
        <Text style={styles.title}>{title}</Text>
        {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      </View>
      {right && <View>{right}</View>}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 },
  textWrap: { flex: 1 },
  title: { fontSize: 28, fontWeight: "700", color: colors.textPrimary, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
}));
