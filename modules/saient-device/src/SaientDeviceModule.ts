import { NativeModule, requireOptionalNativeModule } from "expo";
import type { DeviceProfile } from "@/lib/model-capability";

declare class SaientDeviceModule extends NativeModule<{}> {
  getProfile(): Promise<DeviceProfile>;
}

export default requireOptionalNativeModule<SaientDeviceModule>("SaientDevice");
