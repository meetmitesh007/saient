const SAFE_MODEL_FILE = /^[a-zA-Z0-9][a-zA-Z0-9._ -]*\.gguf$/i;

export function isSafeModelFileName(fileName: string): boolean {
  return fileName.length <= 128 && SAFE_MODEL_FILE.test(fileName) && !fileName.includes("..");
}

export function sanitizeModelFileName(fileName: string): string {
  const normalized = fileName.normalize("NFKC");
  const withoutExtension = normalized.replace(/\.gguf$/i, "");
  const safeBase = withoutExtension
    .replace(/[^a-zA-Z0-9._ -]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[. _-]+|[. _-]+$/g, "")
    .slice(0, 120) || "imported-model";
  return `${safeBase}.gguf`;
}

export function uniqueModelFileName(fileName: string, existing: Iterable<string>): string {
  const safe = sanitizeModelFileName(fileName);
  const used = new Set(Array.from(existing, (name) => name.toLocaleLowerCase()));
  if (!used.has(safe.toLocaleLowerCase())) return safe;

  const base = safe.slice(0, -5);
  let suffix = 2;
  let candidate = `${base}-imported.gguf`;
  while (used.has(candidate.toLocaleLowerCase())) {
    candidate = `${base}-imported-${suffix}.gguf`;
    suffix++;
  }
  return candidate;
}

export function ggufVersionFromBase64Header(header: string): 1 | 2 | 3 | null {
  const compact = header.replace(/\s/g, "");
  if (compact.startsWith("R0dVRgEAAAA")) return 1;
  if (compact.startsWith("R0dVRgIAAAA")) return 2;
  if (compact.startsWith("R0dVRgMAAAA")) return 3;
  return null;
}
