import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(await readFile(path.join(root, "engine/wan/MODEL_PACK_LOCK.json"), "utf8"));
const kotlin = await readFile(
  path.join(root, "modules/saient-diffusion/android/src/main/java/expo/modules/saientdiffusion/SaientDiffusionModule.kt"),
  "utf8",
);

assert.equal(lock.files.reduce((total, file) => total + file.bytes, 0), lock.totalBytes);
assert.match(kotlin, new RegExp(`WAN_PACK_ID = "${lock.id.replaceAll(".", "\\.")}"`));

for (const file of lock.files) {
  const pattern = new RegExp(
    `RemoteModelFile\\("${file.path.replaceAll(".", "\\.")}"[\\s\\S]*?([0-9_]+),\\s*"${file.sha256}"\\)`,
  );
  const match = kotlin.match(pattern);
  assert.ok(match, `Missing native contract for ${file.path}`);
  assert.equal(Number(match[1].replaceAll("_", "")), file.bytes, `Byte mismatch for ${file.path}`);
}

console.log(`Wan contract verified: ${lock.files.length} files, ${lock.totalBytes} bytes`);
