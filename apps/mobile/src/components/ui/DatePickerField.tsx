import { useState, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../lib/theme";

interface Props {
  label: string;
  value: Date;
  onChange: (date: Date) => void;
  minimumDate?: Date;
  maximumDate?: Date;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export function DatePickerField({ label, value, onChange, minimumDate, maximumDate }: Props) {
  const [show, setShow] = useState(false);
  const [viewYear, setViewYear] = useState(value.getFullYear());
  const [viewMonth, setViewMonth] = useState(value.getMonth());

  const formatted = value.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  // Generate calendar grid
  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const days: Array<{ day: number; disabled: boolean } | null> = [];

    // Leading blanks
    for (let i = 0; i < firstDay; i++) days.push(null);

    // Days
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(viewYear, viewMonth, d);
      let disabled = false;
      if (minimumDate && date < new Date(minimumDate.getFullYear(), minimumDate.getMonth(), minimumDate.getDate())) disabled = true;
      if (maximumDate && date > maximumDate) disabled = true;
      days.push({ day: d, disabled });
    }

    return days;
  }, [viewYear, viewMonth, minimumDate, maximumDate]);

  function selectDay(day: number) {
    onChange(new Date(viewYear, viewMonth, day));
    setShow(false);
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  }

  function openPicker() {
    setViewYear(value.getFullYear());
    setViewMonth(value.getMonth());
    setShow(true);
  }

  const isSelected = (day: number) =>
    value.getFullYear() === viewYear &&
    value.getMonth() === viewMonth &&
    value.getDate() === day;

  const isToday = (day: number) => {
    const now = new Date();
    return now.getFullYear() === viewYear && now.getMonth() === viewMonth && now.getDate() === day;
  };

  return (
    <View>
      <Text style={s.label}>{label}</Text>
      <TouchableOpacity style={s.field} onPress={openPicker} activeOpacity={0.7}>
        <Text style={s.value}>{formatted}</Text>
        <Ionicons name="calendar-outline" size={18} color={colors.textMuted} />
      </TouchableOpacity>

      <Modal visible={show} transparent animationType="fade" onRequestClose={() => setShow(false)}>
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={() => setShow(false)}>
          <View style={s.pickerCard} onStartShouldSetResponder={() => true}>
            {/* Month/Year nav */}
            <View style={s.nav}>
              <TouchableOpacity onPress={prevMonth} style={s.navBtn}>
                <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
              </TouchableOpacity>
              <Text style={s.navTitle}>{MONTHS[viewMonth]} {viewYear}</Text>
              <TouchableOpacity onPress={nextMonth} style={s.navBtn}>
                <Ionicons name="chevron-forward" size={20} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            {/* Day headers */}
            <View style={s.row}>
              {DAYS.map((d) => (
                <Text key={d} style={s.dayHeader}>{d}</Text>
              ))}
            </View>

            {/* Calendar grid */}
            <View style={s.grid}>
              {calendarDays.map((item, i) => (
                <View key={i} style={s.cell}>
                  {item ? (
                    <TouchableOpacity
                      style={[
                        s.dayBtn,
                        isSelected(item.day) && s.dayBtnSelected,
                        isToday(item.day) && !isSelected(item.day) && s.dayBtnToday,
                      ]}
                      onPress={() => !item.disabled && selectDay(item.day)}
                      disabled={item.disabled}
                      activeOpacity={0.6}
                    >
                      <Text
                        style={[
                          s.dayText,
                          isSelected(item.day) && s.dayTextSelected,
                          item.disabled && s.dayTextDisabled,
                          isToday(item.day) && !isSelected(item.day) && s.dayTextToday,
                        ]}
                      >
                        {item.day}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ))}
            </View>

            {/* Today shortcut */}
            <TouchableOpacity
              style={s.todayBtn}
              onPress={() => { onChange(new Date()); setShow(false); }}
              activeOpacity={0.7}
            >
              <Text style={s.todayBtnText}>Today</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const CELL_SIZE = 40;

const s = StyleSheet.create({
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

  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center" },
  pickerCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 20,
    width: 320,
    borderWidth: 1,
    borderColor: colors.border,
  },

  nav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  navBtn: { padding: 4 },
  navTitle: { fontSize: 16, fontWeight: "700", color: colors.textPrimary },

  row: { flexDirection: "row", justifyContent: "space-around", marginBottom: 8 },
  dayHeader: { fontSize: 11, fontWeight: "600", color: colors.textMuted, width: CELL_SIZE, textAlign: "center" },

  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, alignItems: "center", marginBottom: 4 },
  dayBtn: { width: CELL_SIZE, height: CELL_SIZE, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  dayBtnSelected: { backgroundColor: colors.brand },
  dayBtnToday: { borderWidth: 1, borderColor: colors.brand },
  dayText: { fontSize: 14, color: colors.textPrimary, fontWeight: "500" },
  dayTextSelected: { color: "#ffffff", fontWeight: "700" },
  dayTextDisabled: { color: colors.textMuted, opacity: 0.3 },
  dayTextToday: { color: colors.brand },

  todayBtn: { alignItems: "center", paddingVertical: 10, marginTop: 8 },
  todayBtnText: { fontSize: 13, fontWeight: "600", color: colors.brand },
});
