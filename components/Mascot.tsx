import { Text, View } from "react-native";
import { C } from "@/lib/theme";

/** The Saient ASCII robot — centred, awake [>_<] or sleepy [-_-]. */
export function Mascot({ size = 22, awake = true }: { size?: number; awake?: boolean }) {
  const art = `${awake ? "[>_<]" : "[-_-]"}\n/|#|\\\n/   \\`;
  return (
    <View style={{ alignItems: "center" }}>
      <Text
        style={{
          fontFamily: "monospace",
          color: C.accent,
          fontSize: size,
          lineHeight: size * 1.15,
          textAlign: "center",
        }}
      >
        {art}
      </Text>
    </View>
  );
}
