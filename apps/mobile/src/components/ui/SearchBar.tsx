import { View, TextInput, TouchableOpacity, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles } from "../../lib/makeStyles";
import { useColors } from "../../contexts/ThemeContext";

interface Props {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
}

export function SearchBar({ value, onChangeText, placeholder = "Search..." }: Props) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.container}>
      <Ionicons name="search-outline" size={18} color={colors.textMuted} />
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        returnKeyType="search"
        autoCorrect={false}
        clearButtonMode="while-editing"
      />
      {value.length > 0 && Platform.OS === "android" && (
        <TouchableOpacity onPress={() => onChangeText("")}>
          <Ionicons name="close-circle" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    gap: 8,
    height: 44,
  },
  input: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
    paddingVertical: 0,
  },
}));
