import assert from "node:assert/strict";
import {
  ggufVersionFromBase64Header,
  isSafeModelFileName,
  sanitizeModelFileName,
  uniqueModelFileName,
} from "../lib/model-files.ts";
import { recommendModelCapability } from "../lib/model-capability.ts";

assert.equal(sanitizeModelFileName("../../Qwen 1.7B?.GGUF"), "Qwen 1.7B.gguf");
assert.equal(isSafeModelFileName("qwen-1.7b.gguf"), true);
assert.equal(isSafeModelFileName("../qwen.gguf"), false);
assert.equal(uniqueModelFileName("qwen.gguf", ["qwen.gguf"]), "qwen-imported.gguf");
assert.equal(
  uniqueModelFileName("qwen.gguf", ["qwen.gguf", "qwen-imported.gguf"]),
  "qwen-imported-2.gguf",
);
assert.equal(ggufVersionFromBase64Header("R0dVRgEAAAA="), 1);
assert.equal(ggufVersionFromBase64Header("R0dVRgIAAAA="), 2);
assert.equal(ggufVersionFromBase64Header("R0dVRgMAAAA="), 3);
assert.equal(ggufVersionFromBase64Header("bm90LWdndWY="), null);

const fourGb = recommendModelCapability({
  totalMemoryBytes: 4 * 1024 ** 3,
  availableMemoryBytes: 1.5 * 1024 ** 3,
  logicalCores: 8,
  architecture: "arm64-v8a",
  platform: "Android",
});
assert.equal(fourGb.tier, "Small / medium");
assert.equal(fourGb.parameters, "1–2B parameters");
assert.equal(fourGb.maxModelBytes, 1_500_000_000);
assert.equal(fourGb.underMemoryPressure, false);

const pressured = recommendModelCapability({
  totalMemoryBytes: 8 * 1024 ** 3,
  availableMemoryBytes: 1 * 1024 ** 3,
  logicalCores: 8,
  architecture: "arm64-v8a",
  platform: "Android",
});
assert.equal(pressured.tier, "Medium / large");
assert.equal(pressured.underMemoryPressure, true);

console.log("model import helpers and 2 device recommendation profiles passed");
