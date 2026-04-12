import { useState, useCallback, useRef, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../lib/theme";

/**
 * Bug B — line-item free-text notes.
 *
 * The backend schema (packages/shared/src/validators.ts::invoiceLineItemSchema)
 * splits `itemName` (required snapshot of the product name) from `description`
 * (optional free-text line note the invoice maker may want to add, e.g.
 * "Keep separate from order #42"). This component renders ONLY the notes
 * field — the item-name picker stays inline in each document's LineItemRow
 * because it carries variant/alt-unit/keyboard-ref wiring that varies per
 * screen.
 *
 * The UX spec ("collapsible + Add notes") was chosen over "always-visible
 * inline notes input" because mobile screen real estate is precious and
 * 99% of lines will not have notes. Default state is a single small muted
 * "+ Add notes" link; tapping it opens a 3-row multiline TextInput with a
 * live char counter (soft 500-char limit, enforced by the validator); tapping
 * Done (or entering text then tapping the notes display) toggles between
 * modes; the notes-display state is italic, muted, with a pencil edit
 * affordance.
 */

const MAX_NOTES_LENGTH = 500;

interface LineItemNotesFieldProps {
  /** Current notes value (free-text line-item comment). Empty string = no notes. */
  value: string;
  /** Change handler. Called with the raw TextInput value (including whitespace). */
  onChange: (next: string) => void;
  /** Optional placeholder. Defaults to "Notes for this line". */
  placeholder?: string;
  /**
   * When the user taps Done we collapse the editor. If the notes are
   * whitespace-only we also trim them via this handler so the parent state
   * matches the wire format (empty string = omitted).
   */
  onCommit?: (trimmed: string) => void;
}

export function LineItemNotesField({
  value,
  onChange,
  placeholder = "Notes for this line",
  onCommit,
}: LineItemNotesFieldProps) {
  const hasNotes = value.trim().length > 0;
  // Editing state is local because the collapsed/expanded toggle is a pure UI
  // concern — the parent only cares about the committed value.
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // Auto-focus when we enter edit mode so the keyboard pops immediately.
  useEffect(() => {
    if (isEditing) {
      // Slight delay to let layout settle on slower Android devices before
      // focusing — direct focus() inside the same frame can race with the
      // TextInput mount and silently fail to raise the keyboard.
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [isEditing]);

  const handleDone = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed !== value) {
      onChange(trimmed);
    }
    onCommit?.(trimmed);
    setIsEditing(false);
  }, [value, onChange, onCommit]);

  const handleOpenEditor = useCallback(() => {
    setIsEditing(true);
  }, []);

  // Soft 500-char limit. The validator max is 500 chars; we also pass
  // maxLength={MAX_NOTES_LENGTH} as a hard stop so there is no way to type
  // past it and then hit a server validation error.
  const charCount = value.length;
  const nearLimit = charCount > MAX_NOTES_LENGTH - 50;

  // ── Edit mode ────────────────────────────────────────────────
  if (isEditing) {
    return (
      <View
        testID="line-item-notes-editor"
        accessibilityLabel="Line item notes editor"
        style={s.editorWrap}
      >
        <TextInput
          ref={inputRef}
          testID="line-item-notes-input"
          style={s.input}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          maxLength={MAX_NOTES_LENGTH}
          returnKeyType="done"
          blurOnSubmit
          onSubmitEditing={handleDone}
        />
        <View style={s.editorFooter}>
          <Text style={[s.charCount, nearLimit && s.charCountNearLimit]}>
            {charCount} / {MAX_NOTES_LENGTH}
          </Text>
          <TouchableOpacity
            testID="line-item-notes-done"
            accessibilityLabel="Done editing notes"
            style={s.doneBtn}
            onPress={handleDone}
            activeOpacity={0.7}
          >
            <Text style={s.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Notes display (collapsed, with value) ────────────────────
  if (hasNotes) {
    return (
      <TouchableOpacity
        testID="line-item-notes-display"
        accessibilityLabel={`Notes: ${value}. Tap to edit.`}
        accessibilityRole="button"
        style={s.displayWrap}
        onPress={handleOpenEditor}
        activeOpacity={0.6}
      >
        <Text style={s.displayText} numberOfLines={3}>
          {value}
        </Text>
        <Ionicons name="pencil-outline" size={13} color={colors.textMuted} style={s.pencilIcon} />
      </TouchableOpacity>
    );
  }

  // ── Default collapsed state — "+ Add notes" link ─────────────
  return (
    <TouchableOpacity
      testID="line-item-notes-add"
      accessibilityLabel="Add notes for this line"
      accessibilityRole="button"
      style={s.addLinkWrap}
      onPress={handleOpenEditor}
      activeOpacity={0.6}
    >
      <Text style={s.addLinkText}>+ Add notes</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  // Collapsed default — muted text button
  addLinkWrap: {
    alignSelf: "flex-start",
    paddingVertical: 4,
    marginTop: 2,
    marginBottom: 6,
  },
  addLinkText: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: "500",
  },
  // Notes display state (collapsed, with value)
  displayWrap: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: colors.bg,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 2,
    marginBottom: 6,
    gap: 6,
  },
  displayText: {
    flex: 1,
    fontSize: 12,
    fontStyle: "italic",
    color: colors.textSecondary,
    lineHeight: 16,
  },
  pencilIcon: {
    marginTop: 1,
  },
  // Edit mode
  editorWrap: {
    marginTop: 2,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: colors.textPrimary,
    minHeight: 68,
  },
  editorFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
  },
  charCount: {
    fontSize: 11,
    color: colors.textMuted,
  },
  charCountNearLimit: {
    color: colors.warning,
  },
  doneBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.brand + "18",
  },
  doneBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.brand,
  },
});
