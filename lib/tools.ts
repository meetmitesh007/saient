// tools.ts — the agent's native tool palette. Each tool is backed by an Android API the app
// has permission for (no shell — Android sandboxes that). Actions that send/dial open the
// system UI pre-filled so the user confirms; only contact lookup needs a runtime permission.

import * as Contacts from "expo-contacts";
import * as SMS from "expo-sms";
import { Linking } from "react-native";

export interface ContactHit {
  name: string;
  number: string;
}

const cleanNumber = (n: string) => n.replace(/[^+\d]/g, "");

async function ensureContactsPermission(): Promise<boolean> {
  const { status } = await Contacts.requestPermissionsAsync();
  return status === "granted";
}

/** Resolve a name (e.g. "wifey", "mum") to matching contacts + phone numbers. */
export async function findContact(name: string): Promise<ContactHit[]> {
  if (!(await ensureContactsPermission())) return [];
  const { data } = await Contacts.getContactsAsync({
    name,
    fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
  });
  const q = name.trim().toLowerCase();
  const hits: ContactHit[] = [];
  for (const c of data) {
    const cname = c.name ?? "";
    if (!c.phoneNumbers?.length) continue;
    if (q && !cname.toLowerCase().includes(q)) continue;
    const number = c.phoneNumbers[0].number ?? "";
    if (number) hits.push({ name: cname, number });
  }
  return hits.slice(0, 5);
}

/**
 * Open the Messages app pre-filled with the text (the user taps send). Uses the system composer —
 * no SEND_SMS permission, which is restricted on Google Play.
 */
export async function sendSms(number: string, message: string): Promise<string> {
  const num = cleanNumber(number);
  if (!(await SMS.isAvailableAsync())) return "SMS isn't available on this device.";
  const { result } = await SMS.sendSMSAsync([num], message);
  return `Opened Messages (${result}).`;
}

/** Open the dialer pre-filled (user taps call). */
export async function call(number: string): Promise<string> {
  await Linking.openURL(`tel:${cleanNumber(number)}`);
  return "Opened the dialer.";
}

/** Open the new-contact form pre-filled (user saves). */
export async function addContact(name: string, number: string): Promise<string> {
  if (!(await ensureContactsPermission())) return "Contacts permission was denied.";
  await Contacts.presentFormAsync(null, {
    name,
    contactType: Contacts.ContactTypes.Person,
    phoneNumbers: [{ label: "mobile", number: cleanNumber(number) }],
  } as Contacts.Contact);
  return "Opened the new-contact form.";
}

const stripHtml = (s: string) =>
  s.replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();

// DuckDuckGo no-JS HTML scrape (broad results when it isn't blocking the IP). RN fetch ignores CORS.
async function searchDuckDuckGo(query: string): Promise<string> {
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36" },
    });
    const html = await res.text();
    const titles = [...html.matchAll(/class="result__a"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => stripHtml(m[1]));
    const snips = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => stripHtml(m[1]));
    const out: string[] = [];
    for (let i = 0; i < Math.min(5, Math.max(titles.length, snips.length)); i++) {
      const line = `${titles[i] ?? ""}${titles[i] && snips[i] ? " — " : ""}${snips[i] ?? ""}`.trim();
      if (line) out.push(`${i + 1}. ${line}`);
    }
    return out.join("\n");
  } catch {
    return "";
  }
}

// Wikipedia API — reliable, free, CORS-enabled (origin=*), never blocks. Great for facts; the fallback.
async function searchWikipedia(query: string): Promise<string> {
  try {
    const url =
      `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&exintro=1&explaintext=1` +
      `&redirects=1&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=3&origin=*`;
    const res = await fetch(url, { headers: { "User-Agent": "Saient/1.0 (https://saient.co.uk)" } });
    const data: any = await res.json();
    const pages = data?.query?.pages;
    if (!pages) return "";
    const out: string[] = [];
    for (const k of Object.keys(pages)) {
      const ex = String(pages[k].extract ?? "").replace(/\s+/g, " ").trim();
      if (ex) out.push(`${pages[k].title}: ${ex.slice(0, 600)}`);
    }
    return out.join("\n\n");
  } catch {
    return "";
  }
}

/**
 * Web search from the phone: try DuckDuckGo (broad) and fall back to Wikipedia (reliable). Returns
 * result text to feed back into the model. MVP — swap in a keyed search API (Brave via saient.co.uk)
 * for production-grade real-time coverage.
 */
export async function webSearch(query: string): Promise<string> {
  const ddg = await searchDuckDuckGo(query);
  if (ddg) return ddg;
  const wiki = await searchWikipedia(query);
  return wiki || "No results found.";
}
