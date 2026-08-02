// agent.ts — on-device agent. Explicit phone/search commands take a deterministic fast path;
// ambiguous action wording gets one structured model call. Native tools are orchestrated in
// code (find_contact -> send_sms/call), and everything else goes straight to plain chat.

import { quartzChat, type ChatMsg } from "./quartz";
import * as tools from "./tools";

const NO_THINK = "\n/no_think";

const EXTRACT =
  `You convert the user's request into ONE JSON action. Reply with ONLY the JSON object and nothing else.\n` +
  `{"action": "text" | "call" | "add_contact" | "search" | "chat", "name": "", "message": "", "number": "", "query": ""}\n` +
  `- text: send an SMS/text/message to a person (fill name and message)\n` +
  `- call: phone/ring/call a person (fill name)\n` +
  `- add_contact: save a new contact (fill name and number)\n` +
  `- search: look something up on the internet — news, weather, sport, prices, or any current/real-world fact (fill query)\n` +
  `- chat: greetings, opinions, or things you can answer from your own knowledge\n` +
  `Examples:\n` +
  `"text wifey running 10 late" => {"action":"text","name":"wifey","message":"running 10 late","number":"","query":""}\n` +
  `"can you call mum" => {"action":"call","name":"mum","message":"","number":"","query":""}\n` +
  `"add contact Joe 07700900123" => {"action":"add_contact","name":"Joe","message":"","number":"07700900123","query":""}\n` +
  `"what's the weather in London" => {"action":"search","name":"","message":"","number":"","query":"weather in London"}\n` +
  `"who won the match last night" => {"action":"search","name":"","message":"","number":"","query":"who won the match last night"}\n` +
  `"hello how are you" => {"action":"chat","name":"","message":"","number":"","query":""}` +
  NO_THINK;

export type AgentEvent =
  | { type: "tool"; name: string; args: Record<string, unknown> }
  | { type: "result"; text: string }
  | { type: "final"; text: string };

interface Intent { action: string; name: string; message: string; number: string; query: string; }

const blankIntent = (action: string): Intent => ({ action, name: "", message: "", number: "", query: "" });

export function fastIntent(input: string): Intent | null {
  const text = input.trim();
  if (!text) return null;

  let match = text.match(/^(?:please\s+)?(?:can you\s+)?(?:text|message|sms)\s+(.+?)\s+(?:saying|that|to say)\s+(.+)$/i);
  if (match) return { ...blankIntent("text"), name: match[1].trim(), message: match[2].trim() };

  match = text.match(/^(?:please\s+)?(?:can you\s+)?(?:text|message|sms)\s+(\S+)\s+(.+)$/i);
  if (match) return { ...blankIntent("text"), name: match[1], message: match[2].trim() };

  match = text.match(/^(?:please\s+)?(?:can you\s+)?(?:call|ring|phone)\s+(.+?)[?.!]*$/i);
  if (match) return { ...blankIntent("call"), name: match[1].trim() };

  match = text.match(/^(?:please\s+)?(?:add|save)(?:\s+a)?\s+contact\s+(.+?)\s+([+\d][\d\s()-]{5,})[?.!]*$/i);
  if (match) return { ...blankIntent("add_contact"), name: match[1].trim(), number: match[2].trim() };

  if (/\b(weather|forecast|news|scores?|match|stocks?|share price|price of|latest|today|tonight|yesterday|current(?:ly)?|live)\b/i.test(text) ||
      /\b(?:look up|search for|find online)\b/i.test(text)) {
    return { ...blankIntent("search"), query: text };
  }

  return null;
}

function needsIntentModel(input: string): boolean {
  return /\b(text|message|sms|call|ring|phone|contact)\b/i.test(input);
}

function parseIntent(text: string): Intent | null {
  const m = text.match(/\{[\s\S]*?"action"[\s\S]*?\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    return {
      action: String(o.action ?? "chat").toLowerCase(),
      name: String(o.name ?? ""),
      message: String(o.message ?? ""),
      number: String(o.number ?? ""),
      query: String(o.query ?? ""),
    };
  } catch {
    return null;
  }
}

async function complete(messages: ChatMsg[], signal?: AbortSignal): Promise<string> {
  let out = "";
  await quartzChat(messages, (t) => { out += t; }, signal);
  return out.trim();
}

export async function runAgent(
  userText: string,
  onEvent: (e: AgentEvent) => void,
  confirm: (name: string, message: string) => Promise<boolean>,
  signal?: AbortSignal,
): Promise<void> {
  // 1) Fast-path explicit commands; ask the model only when action wording is ambiguous.
  let intent = fastIntent(userText);
  if (!intent && needsIntentModel(userText)) {
    const raw = await complete([{ role: "system", content: EXTRACT }, { role: "user", content: userText }], signal);
    if (signal?.aborted) return;
    intent = parseIntent(raw);
  }

  // 2) Deterministic orchestration.
  // Web search: fetch results from the phone, then answer grounded in them.
  if (intent?.action === "search" && intent.query) {
    onEvent({ type: "tool", name: "web_search", args: { query: intent.query } });
    const results = await tools.webSearch(intent.query);
    if (signal?.aborted) return;
    onEvent({ type: "result", text: results.length > 200 ? results.slice(0, 200) + "…" : results });
    const answer = await complete(
      [
        { role: "system", content: "You are Saient. Answer the user's question using the web results below. Be concise and direct; if the results don't cover it, say so plainly." + NO_THINK },
        { role: "user", content: `Question: ${userText}\n\nWeb results:\n${results}` },
      ],
      signal,
    );
    onEvent({ type: "final", text: answer });
    return;
  }

  // Anything without a clear phone action → plain chat.
  if (!intent || intent.action === "chat" || (!intent.name && !intent.number)) {
    const reply = await complete(
      [{ role: "system", content: "You are Saient, a concise, friendly assistant running on this phone." + NO_THINK }, { role: "user", content: userText }],
      signal,
    );
    onEvent({ type: "final", text: reply });
    return;
  }

  if (intent.action === "add_contact") {
    onEvent({ type: "tool", name: "add_contact", args: { name: intent.name, number: intent.number } });
    const r = await tools.addContact(intent.name, intent.number);
    onEvent({ type: "result", text: r });
    onEvent({ type: "final", text: `Opened the new-contact form for ${intent.name}.` });
    return;
  }

  // text or call: resolve the contact, then act.
  onEvent({ type: "tool", name: "find_contact", args: { name: intent.name } });
  const hits = await tools.findContact(intent.name);
  if (!hits.length) {
    onEvent({ type: "result", text: `No contact matching "${intent.name}".` });
    onEvent({ type: "final", text: `I couldn't find a contact called ${intent.name}.` });
    return;
  }
  const hit = hits[0];
  onEvent({ type: "result", text: `Found ${hit.name} — ${hit.number}` });

  if (intent.action === "call") {
    onEvent({ type: "tool", name: "call", args: { number: hit.number } });
    const r = await tools.call(hit.number);
    onEvent({ type: "result", text: r });
    onEvent({ type: "final", text: `Calling ${hit.name}.` });
    return;
  }

  // text — confirm with the user before actually sending (agent never fires a text silently).
  const message = intent.message || "(no message)";
  const ok = await confirm(hit.name, message);
  if (!ok) {
    onEvent({ type: "final", text: `Okay — didn't send anything to ${hit.name}.` });
    return;
  }
  onEvent({ type: "tool", name: "send_sms", args: { number: hit.number, message } });
  const r = await tools.sendSms(hit.number, message);
  onEvent({ type: "result", text: r });
  onEvent({ type: "final", text: `Opened a text to ${hit.name} in Messages — tap send there: "${message}"` });
}
