import { Text, TouchableOpacity, type StyleProp, type TextStyle } from "react-native";
import { useRouter } from "expo-router";
import { useColors } from "../contexts/ThemeContext";

/**
 * Item name on a document line. When the line references a catalogue item
 * (`itemId`) it is tappable and pushes the item screen, so the native back
 * gesture returns to the document. Free-text lines render as plain text.
 */
export function LineItemNameLink({
  itemId,
  name,
  style,
  numberOfLines = 2,
}: {
  itemId?: string | null;
  name: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const router = useRouter();
  const colors = useColors();
  if (!itemId) {
    return (
      <Text style={style} numberOfLines={numberOfLines}>
        {name}
      </Text>
    );
  }
  return (
    <TouchableOpacity
      onPress={() => router.push(`/(app)/(items)/${itemId}` as never)}
      accessibilityRole="link"
      accessibilityLabel={`Open item ${name}`}
    >
      <Text style={[style, { color: colors.brand }]} numberOfLines={numberOfLines}>
        {name}
      </Text>
    </TouchableOpacity>
  );
}
