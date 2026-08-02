import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C } from "@/lib/theme";

type Step = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
};

const STEPS: Step[] = [
  {
    icon: "phone-portrait-outline",
    title: "Your AI, on your phone",
    body: "Saient runs a full AI model entirely on this device. 100% offline — no cloud, no API keys, and nothing you type ever leaves your phone.",
  },
  {
    icon: "cube-outline",
    title: "Download a model",
    body: "Open the Models tab and tap Get on a model to download it. It’s stored on your phone and powers every reply. You can swap models any time.",
  },
  {
    icon: "chatbubble-ellipses-outline",
    title: "Just start chatting",
    body: "Type on the Chat tab and Saient answers on-device — so it keeps working in airplane mode, on the train, anywhere.",
  },
  {
    icon: "construct-outline",
    title: "Let it act for you",
    body: "Turn on Agent in the chat header to have Saient text or call the people you ask it to. It always shows you the message and asks before sending.",
  },
  {
    icon: "battery-charging-outline",
    title: "Save battery when idle",
    body: "Done for now? Tap Unload on the Models tab to free the model from memory. Tap Load to bring it back in a couple of seconds.",
  },
];

export function SetupWizard({
  visible,
  onDone,
}: {
  visible: boolean;
  onDone: (finished: boolean) => void;
}) {
  const insets = useSafeAreaInsets();
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  const next = () => {
    if (last) onDone(true);
    else setI((n) => n + 1);
  };
  const back = () => setI((n) => Math.max(0, n - 1));

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={() => onDone(false)} statusBarTranslucent>
      <View style={[styles.root, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.topRow}>
          {i > 0 ? (
            <Pressable onPress={back} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
              <Ionicons name="chevron-back" size={26} color={C.text2} />
            </Pressable>
          ) : (
            <View style={styles.backSpacer} />
          )}
          <Pressable onPress={() => onDone(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Skip setup">
            <Text style={styles.skip}>Skip</Text>
          </Pressable>
        </View>

        <View style={styles.body}>
          <View style={styles.iconWrap}>
            <Ionicons name={step.icon} size={46} color={C.accent} />
          </View>
          <Text style={styles.title}>{step.title}</Text>
          <Text style={styles.text}>{step.body}</Text>
        </View>

        <View style={styles.dots}>
          {STEPS.map((_, d) => (
            <View key={d} style={[styles.dot, d === i && styles.dotActive]} />
          ))}
        </View>

        <Pressable style={styles.cta} onPress={next} accessibilityRole="button">
          <Text style={styles.ctaText}>{last ? "Get started" : "Next"}</Text>
          {!last && <Ionicons name="arrow-forward" size={18} color={C.bg} />}
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 28 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 40 },
  backSpacer: { width: 26 },
  skip: { color: C.text2, fontSize: 15, fontWeight: "600" },
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: 18 },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: 28,
    backgroundColor: C.bg2,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  title: { color: C.text, fontSize: 24, fontWeight: "800", textAlign: "center" },
  text: { color: C.text2, fontSize: 16, lineHeight: 24, textAlign: "center", maxWidth: 340 },
  dots: { flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 22 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.bg3 },
  dotActive: { backgroundColor: C.accent, width: 20 },
  cta: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: C.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  ctaText: { color: C.bg, fontSize: 16, fontWeight: "800" },
});
