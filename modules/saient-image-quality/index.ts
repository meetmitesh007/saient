import SaientImageQualityModule, { type NativeImageQuality } from "./src/SaientImageQualityModule";

export type { NativeImageQuality };

export async function analyzeImageQuality(base64: string): Promise<NativeImageQuality | null> {
  if (!SaientImageQualityModule) return null;
  return SaientImageQualityModule.analyze(base64);
}
