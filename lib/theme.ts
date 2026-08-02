// Saient dark theme — mirrors the desktop app's palette.
export const C = {
  bg: "#0d0d0f",
  bg2: "#141418",
  bg3: "#1a1a20",
  border: "#2a2a35",
  text: "#e8e8f0",
  text2: "#a0a0b8",
  text3: "#606078",
  accent: "#6c8ef5",
  accentDim: "#4a63b8",
  green: "#00d68f",
  amber: "#f5a623",
  red: "#f87171",
  userBubble: "#222a44",
} as const;

export const mono =
  // RN doesn't ship a mono by default; these resolve to the platform monospace.
  "monospace";
