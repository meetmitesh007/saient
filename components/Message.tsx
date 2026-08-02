import { StyleSheet, Text, View } from "react-native";
import { Artifact } from "@/components/Artifact";
import { C } from "@/lib/theme";

export interface UIMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  kind?: "tool"; // an agent tool action / result line
}

type Seg = { type: "text"; text: string } | { type: "code"; lang: string; text: string };

// Split a reply into prose + fenced code blocks (```lang ... ```). Tolerates an UNCLOSED trailing
// fence — small models routinely forget the closing ``` (and it lets code stream live into a card).
function parseSegments(content: string): Seg[] {
  const segs: Seg[] = [];
  const fence = /```(\w*)[ \t]*\n?/g;
  let pos = 0;
  for (;;) {
    fence.lastIndex = pos;
    const open = fence.exec(content);
    if (!open) {
      if (pos < content.length) segs.push({ type: "text", text: content.slice(pos) });
      break;
    }
    if (open.index > pos) segs.push({ type: "text", text: content.slice(pos, open.index) });
    const codeStart = fence.lastIndex;
    const close = content.indexOf("```", codeStart);
    const end = close === -1 ? content.length : close;
    segs.push({ type: "code", lang: open[1], text: content.slice(codeStart, end).replace(/\n$/, "") });
    pos = close === -1 ? content.length : close + 3;
  }
  return segs;
}

const isHtmlCode = (lang: string, code: string) =>
  /^html?$/i.test(lang) ||
  /<(?:!doctype\s+html|html|body|head|main|section|div|button|style)\b/i.test(code);

export function Message({ msg, onPreview }: { msg: UIMessage; onPreview?: (html: string) => void }) {
  if (msg.kind === "tool") {
    return (
      <View style={styles.toolRow}>
        <Text style={styles.toolText}>{msg.content}</Text>
      </View>
    );
  }

  const isUser = msg.role === "user";

  // Assistant reply containing code → render the code as artifact cards, prose as bubbles.
  if (!isUser && msg.content.includes("```")) {
    const segs = parseSegments(msg.content);
    return (
      <View style={styles.artifactRow}>
        {segs.map((s, i) =>
          s.type === "code" ? (
            <Artifact
              key={i}
              lang={s.lang}
              code={s.text}
              onPreview={onPreview && isHtmlCode(s.lang, s.text) ? () => onPreview(s.text) : undefined}
            />
          ) : s.text.trim() ? (
            <View key={i} style={[styles.bubble, styles.ai, styles.aiInline]}>
              <Text style={styles.text}>{s.text.trim()}</Text>
            </View>
          ) : null,
        )}
      </View>
    );
  }

  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowAI]}>
      <View style={[styles.bubble, isUser ? styles.user : styles.ai]}>
        <Text style={styles.text}>
          {msg.content}
          {msg.streaming && !msg.content ? "…" : ""}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toolRow: { width: "100%", paddingHorizontal: 24, marginVertical: 3, alignItems: "center" },
  toolText: { color: C.text3, fontSize: 12, fontFamily: "monospace", textAlign: "center" },
  row: { width: "100%", paddingHorizontal: 14, marginVertical: 5 },
  rowUser: { alignItems: "flex-end" },
  rowAI: { alignItems: "flex-start" },
  artifactRow: { width: "100%", paddingHorizontal: 14, marginVertical: 5 },
  bubble: { maxWidth: "86%", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16 },
  aiInline: { alignSelf: "flex-start", maxWidth: "92%", marginVertical: 3 },
  user: { backgroundColor: C.userBubble, borderBottomRightRadius: 4 },
  ai: { backgroundColor: C.bg2, borderWidth: 1, borderColor: C.border, borderBottomLeftRadius: 4 },
  text: { color: C.text, fontSize: 15, lineHeight: 21 },
});
