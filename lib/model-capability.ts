const GIB = 1024 ** 3;

export interface DeviceProfile {
  totalMemoryBytes: number;
  availableMemoryBytes?: number;
  appMemoryClassBytes?: number;
  logicalCores: number;
  architecture: string;
  platform: string;
}

export interface ModelCapability {
  tier: string;
  parameters: string;
  maxModelBytes: number;
  quantization: string;
  underMemoryPressure: boolean;
}

export function recommendModelCapability(profile: DeviceProfile): ModelCapability {
  const total = profile.totalMemoryBytes;
  let tier: string;
  let parameters: string;
  let maxModelBytes: number;

  if (total < 3 * GIB) {
    tier = "Tiny";
    parameters = "0.5–1B parameters";
    maxModelBytes = 800_000_000;
  } else if (total < 4.5 * GIB) {
    tier = "Small / medium";
    parameters = "1–2B parameters";
    maxModelBytes = 1_500_000_000;
  } else if (total < 6.5 * GIB) {
    tier = "Medium";
    parameters = "2–3B parameters";
    maxModelBytes = 2_500_000_000;
  } else if (total < 9.5 * GIB) {
    tier = "Medium / large";
    parameters = "3–7B parameters";
    maxModelBytes = 4_500_000_000;
  } else {
    tier = "Large";
    parameters = "7–9B parameters";
    maxModelBytes = 6_500_000_000;
  }

  const available = profile.availableMemoryBytes;
  return {
    tier,
    parameters,
    maxModelBytes,
    quantization: "Q4_K_M preferred; Q5 uses more memory",
    underMemoryPressure: available != null && available / total < 0.22,
  };
}
