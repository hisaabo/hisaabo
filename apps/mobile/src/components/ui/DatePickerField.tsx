import { useState } from "react";
import { View, Text, TouchableOpacity, Platform } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles } from "../../lib/makeStyles";
import { useColors } from "../../contexts/ThemeContext";

interface Props {
  label: string;
  value: Date;
  onChange: (date: Date) => void;
  minimumDate?: Date;
  maximumDate?: Date;
}

export function DatePickerField({ label, value, onChange, minimumDate, maximumDate }: Props) {
  const [show, setShow] = useState(false);
  const s = useS();
  const colors = useColors();

  const formatted = value.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <View>
      <Text style={s.label}>{label}</Text>
      <TouchableOpacity style={s.field} onPress={() => setShow(true)} activeOpacity={0.7}>
        <Text style={s.value}>{formatted}</Text>
        <Ionicons name="calendar-outline" size={18} color={colors.textMuted} />
      </TouchableOpacity>

      {show && (
        <DateTimePicker
          value={value}
          mode="date"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={(_event, selectedDate) => {
            setShow(Platform.OS === "ios"); // iOS keeps open, Android closes on pick
            if (selectedDate) onChange(selectedDate);
          }}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          themeVariant="dark"
        />
      )}
    </View>
  );
}

const useS = makeStyles((colors) => ({
  label: { fontSize: 12, fontWeight: "600", color: colors.textSecondary, marginBottom: 6 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  value: { fontSize: 14, color: colors.textPrimary, fontWeight: "500" },
}));
