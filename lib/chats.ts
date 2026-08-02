import * as FS from "expo-file-system/legacy";

const CHATS_DIR = `${FS.documentDirectory}chats/`;
const CHAT_ID = /^chat-[0-9]+-[a-z0-9]+$/;

export interface SavedChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  kind?: "tool";
}

export interface SavedChat {
  version: 1;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: SavedChatMessage[];
}

async function ensureChatsDir(): Promise<void> {
  const info = await FS.getInfoAsync(CHATS_DIR);
  if (!info.exists) await FS.makeDirectoryAsync(CHATS_DIR, { intermediates: true });
}

function chatPath(id: string): string {
  if (!CHAT_ID.test(id)) throw new Error("Invalid saved chat ID");
  return `${CHATS_DIR}${id}.json`;
}

function isSavedMessage(value: unknown): value is SavedChatMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<SavedChatMessage>;
  return (
    typeof message.id === "string"
    && (message.role === "user" || message.role === "assistant")
    && typeof message.content === "string"
    && (message.kind == null || message.kind === "tool")
  );
}

function parseSavedChat(value: unknown): SavedChat | null {
  if (!value || typeof value !== "object") return null;
  const chat = value as Partial<SavedChat>;
  if (
    chat.version !== 1
    || typeof chat.id !== "string"
    || !CHAT_ID.test(chat.id)
    || typeof chat.title !== "string"
    || typeof chat.createdAt !== "number"
    || typeof chat.updatedAt !== "number"
    || !Array.isArray(chat.messages)
    || !chat.messages.every(isSavedMessage)
  ) return null;
  return chat as SavedChat;
}

function chatTitle(messages: SavedChatMessage[]): string {
  const firstUser = messages.find((message) => message.role === "user")?.content ?? "Saved chat";
  const compact = firstUser.replace(/\s+/g, " ").trim();
  return compact.length > 52 ? `${compact.slice(0, 49)}…` : compact || "Saved chat";
}

export async function listSavedChats(): Promise<SavedChat[]> {
  await ensureChatsDir();
  const names = await FS.readDirectoryAsync(CHATS_DIR);
  const chats = await Promise.all(names.filter((name) => name.endsWith(".json")).map(async (name) => {
    try {
      return parseSavedChat(JSON.parse(await FS.readAsStringAsync(`${CHATS_DIR}${name}`)));
    } catch {
      return null;
    }
  }));
  return chats
    .filter((chat): chat is SavedChat => chat != null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveChat(
  messages: SavedChatMessage[],
  existing?: SavedChat | null,
): Promise<SavedChat> {
  if (messages.length === 0) throw new Error("There is nothing to save");
  await ensureChatsDir();
  const now = Date.now();
  const id = existing?.id ?? `chat-${now}-${Math.random().toString(36).slice(2, 10)}`;
  const chat: SavedChat = {
    version: 1,
    id,
    title: chatTitle(messages),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    messages: messages.map(({ id: messageId, role, content, kind }) => ({
      id: messageId,
      role,
      content,
      ...(kind ? { kind } : {}),
    })),
  };
  await FS.writeAsStringAsync(chatPath(id), JSON.stringify(chat));
  return chat;
}

export async function deleteSavedChat(id: string): Promise<void> {
  await FS.deleteAsync(chatPath(id), { idempotent: true });
}
