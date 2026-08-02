// models.ts — on-device model catalog + downloads for Quartz.
//
// Models are never bundled: the curated catalog and GGUF files live on the Saient Pi,
// the app downloads the chosen one into its private model folder, and the Quartz engine picks
// it up (its dual-dir scan + the `.active` marker). Only license-clean models we can
// redistribute are listed.

import * as DocumentPicker from "expo-document-picker";
import * as FS from "expo-file-system/legacy";
import {
  ggufVersionFromBase64Header,
  isSafeModelFileName,
  uniqueModelFileName,
} from "@/lib/model-files";

export const MODELS_DIR = FS.documentDirectory + "models/";
const ACTIVE_MARKER = MODELS_DIR + ".active";
const PAUSED_MARKER = MODELS_DIR + ".paused";
const MIN_IMPORTED_MODEL_BYTES = 1_000_000;

// Source of truth for the curated list. Falls back to FALLBACK if unreachable.
export const CATALOG_URL = "https://saient.co.uk/api/models";

export type Tier = "Tiny" | "Medium" | "Large";

export interface ModelEntry {
  id: string;
  name: string;
  file: string;        // local filename, e.g. qwen3-1.7b-q4km.gguf
  url: string;         // download URL on the Saient Pi
  sizeBytes: number;
  quant: string;       // e.g. Q4_K_M
  params: string;      // e.g. 1.5B
  tier: Tier;
  license: string;     // e.g. Apache-2.0
  licenseUrl?: string;
  desc?: string;
}

// Offline fallback so the Models tab still works if saient.co.uk is unreachable.
const PI_MODELS = "https://saient.co.uk/models";
export const FALLBACK: ModelEntry[] = [
  {
    id: "qwen3-1.7b-q4km",
    name: "Qwen3 1.7B",
    file: "qwen3-1.7b-q4km.gguf",
    url: `${PI_MODELS}/qwen3-1.7b-q4km.gguf`,
    sizeBytes: 1_282_439_264,
    quant: "Q4_K_M", params: "1.7B", tier: "Medium",
    license: "Apache-2.0", licenseUrl: "https://huggingface.co/Qwen/Qwen3-1.7B/blob/main/LICENSE",
    desc: "A stronger on-device all-rounder for chat and agent tasks.",
  },
];

export async function ensureDir(): Promise<void> {
  const info = await FS.getInfoAsync(MODELS_DIR);
  if (!info.exists) await FS.makeDirectoryAsync(MODELS_DIR, { intermediates: true });
}

export async function fetchCatalog(): Promise<ModelEntry[]> {
  try {
    const r = await fetch(CATALOG_URL, { headers: { Accept: "application/json" } });
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data) && data.length) return data as ModelEntry[];
    }
  } catch {
    /* offline / not deployed yet — use fallback */
  }
  return FALLBACK;
}

/** Map of downloaded filename -> size in bytes. */
export async function listLocal(): Promise<Record<string, number>> {
  await ensureDir();
  const names = await FS.readDirectoryAsync(MODELS_DIR);
  const out: Record<string, number> = {};
  for (const n of names) {
    if (!isSafeModelFileName(n)) continue;
    const info = await FS.getInfoAsync(MODELS_DIR + n);
    if (info.exists && !info.isDirectory) out[n] = info.size ?? 0;
  }
  return out;
}

export interface DownloadHandle {
  promise: Promise<string | null>;
  cancel: () => Promise<void>;
}

export interface DownloadedModelCandidate {
  sourceUri: string;
  fileName: string;
  sizeBytes: number;
  ggufVersion: 1 | 2 | 3;
}

export interface DownloadedModelSearchResult {
  models: DownloadedModelCandidate[];
  rejectedFiles: number;
}

export interface ImportedModel {
  fileName: string;
  sizeBytes: number;
  ggufVersion: 1 | 2 | 3;
}

async function readGgufVersion(uri: string): Promise<1 | 2 | 3 | null> {
  const header = await FS.readAsStringAsync(uri, {
    encoding: FS.EncodingType.Base64,
    position: 0,
    length: 8,
  });
  return ggufVersionFromBase64Header(header);
}

function isPickerCacheUri(uri: string): boolean {
  return FS.cacheDirectory != null && uri.startsWith(FS.cacheDirectory);
}

async function discardPickerCacheUri(uri: string): Promise<void> {
  if (isPickerCacheUri(uri)) {
    await FS.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }
}

/** Remove app-owned temporary copies left by selected candidates that were not imported. */
export async function discardDownloadedModelCandidates(
  candidates: Iterable<DownloadedModelCandidate>,
): Promise<void> {
  await Promise.all(Array.from(candidates, (candidate) => discardPickerCacheUri(candidate.sourceUri)));
}

/** Open the scoped system file search, then check the selected GGUF v1-v3 candidates. */
export async function searchDownloadsForModels(): Promise<DownloadedModelSearchResult | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: "*/*",
    // Android's scoped picker returns content:// URIs, which the legacy FileSystem API cannot
    // inspect directly. Let the picker make one app-owned copy, then move that copy into the
    // model directory during import so a large model is never duplicated a second time.
    copyToCacheDirectory: true,
    multiple: true,
  });
  if (result.canceled) return null;
  const models: DownloadedModelCandidate[] = [];
  let rejectedFiles = 0;

  for (const asset of result.assets) {
    if (!asset.name.toLocaleLowerCase().endsWith(".gguf")) {
      rejectedFiles++;
      await discardPickerCacheUri(asset.uri);
      continue;
    }
    try {
      const info = await FS.getInfoAsync(asset.uri);
      const sizeBytes = asset.size ?? (info.exists && !info.isDirectory ? info.size : 0);
      const ggufVersion = sizeBytes >= MIN_IMPORTED_MODEL_BYTES
        ? await readGgufVersion(asset.uri)
        : null;
      if (!ggufVersion) {
        rejectedFiles++;
        await discardPickerCacheUri(asset.uri);
        continue;
      }
      models.push({ sourceUri: asset.uri, fileName: asset.name, sizeBytes, ggufVersion });
    } catch {
      rejectedFiles++;
      await discardPickerCacheUri(asset.uri);
    }
  }
  models.sort((a, b) => a.fileName.localeCompare(b.fileName));
  return { models, rejectedFiles };
}

/** Move a selected model into Quartz's private folder, validating before an atomic rename. */
export async function importDownloadedModel(candidate: DownloadedModelCandidate): Promise<ImportedModel> {
  await ensureDir();
  const local = await listLocal();
  const fileName = uniqueModelFileName(candidate.fileName, Object.keys(local));
  const destination = MODELS_DIR + fileName;
  const partial = `${MODELS_DIR}.${fileName}.${Date.now()}.part`;

  try {
    if (isPickerCacheUri(candidate.sourceUri)) {
      await FS.moveAsync({ from: candidate.sourceUri, to: partial });
    } else {
      await FS.copyAsync({ from: candidate.sourceUri, to: partial });
    }
    const info = await FS.getInfoAsync(partial);
    if (!info.exists || info.isDirectory || info.size !== candidate.sizeBytes) {
      throw new Error("The source file changed or the copy was incomplete. Nothing was imported.");
    }
    const ggufVersion = await readGgufVersion(partial);
    if (!ggufVersion) {
      throw new Error("The selected file does not have a supported GGUF v1-v3 header.");
    }
    await FS.moveAsync({ from: partial, to: destination });
    return { fileName, sizeBytes: info.size, ggufVersion };
  } catch (error) {
    await FS.deleteAsync(partial, { idempotent: true }).catch(() => {});
    throw error;
  }
}

/** Start a resumable download; onProgress gets a 0..1 fraction. */
export function downloadModel(entry: ModelEntry, onProgress: (frac: number) => void): DownloadHandle {
  const dest = MODELS_DIR + entry.file;
  // Download to a .part file and only rename to the real name when complete, so the engine
  // supervisor never tries to load a half-written model.
  const tmp = dest + ".part";
  const task = FS.createDownloadResumable(entry.url, tmp, {}, (p) => {
    const total = p.totalBytesExpectedToWrite || entry.sizeBytes || 0;
    if (total > 0) onProgress(Math.min(0.999, p.totalBytesWritten / total));
  });
  let poll: ReturnType<typeof setInterval> | undefined;
  const promise = (async () => {
    await ensureDir();
    await FS.deleteAsync(tmp, { idempotent: true }); // clear any stale partial
    // The download callback can be coarse, so also poll the partial file size for a smooth read.
    poll = setInterval(async () => {
      try {
        const info = await FS.getInfoAsync(tmp);
        if (info.exists && !info.isDirectory && info.size && entry.sizeBytes) {
          onProgress(Math.min(0.999, info.size / entry.sizeBytes));
        }
      } catch {
        /* file not there yet */
      }
    }, 500);
    try {
      const res = await task.downloadAsync();
      if (poll) clearInterval(poll);
      if (!res?.uri) return null;
      await FS.deleteAsync(dest, { idempotent: true });
      await FS.moveAsync({ from: tmp, to: dest }); // now the supervisor can pick it up
      onProgress(1);
      return dest;
    } finally {
      if (poll) clearInterval(poll);
    }
  })();
  return {
    promise,
    cancel: async () => {
      if (poll) clearInterval(poll);
      try { await task.cancelAsync(); } catch {}
      try { await FS.deleteAsync(tmp, { idempotent: true }); } catch {}
    },
  };
}

export async function deleteModel(file: string): Promise<void> {
  if (!isSafeModelFileName(file)) throw new Error("Invalid model filename.");
  await FS.deleteAsync(MODELS_DIR + file, { idempotent: true });
  if ((await getActive()) === file) await FS.deleteAsync(ACTIVE_MARKER, { idempotent: true });
}

export async function getActive(): Promise<string | null> {
  try {
    const v = (await FS.readAsStringAsync(ACTIVE_MARKER)).trim();
    return isSafeModelFileName(v) ? v : null;
  } catch {
    return null;
  }
}

export async function setActive(file: string): Promise<void> {
  if (!isSafeModelFileName(file)) throw new Error("Invalid model filename.");
  await ensureDir();
  const info = await FS.getInfoAsync(MODELS_DIR + file);
  if (!info.exists || info.isDirectory) throw new Error("Model file is not available on this device.");
  await FS.writeAsStringAsync(ACTIVE_MARKER, file);
}

// Engine pause: the native supervisor watches for this marker and, when present, kills the engine
// process so the model leaves RAM (battery/memory saver). Removing it lets the engine reload within
// a poll cycle. Same marker-file contract as `.active`.
export async function isEnginePaused(): Promise<boolean> {
  try {
    return (await FS.getInfoAsync(PAUSED_MARKER)).exists;
  } catch {
    return false;
  }
}

export async function setEnginePaused(paused: boolean): Promise<void> {
  await ensureDir();
  if (paused) await FS.writeAsStringAsync(PAUSED_MARKER, "1");
  else await FS.deleteAsync(PAUSED_MARKER, { idempotent: true });
}

export function fmtBytes(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + " GB";
  if (n >= 1e6) return Math.round(n / 1e6) + " MB";
  return Math.round(n / 1e3) + " KB";
}
