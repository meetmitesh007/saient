import SaientDeviceModule from "./src/SaientDeviceModule";
import type { DeviceProfile } from "@/lib/model-capability";

export async function getDeviceProfile(): Promise<DeviceProfile | null> {
  if (!SaientDeviceModule) return null;
  return SaientDeviceModule.getProfile();
}
