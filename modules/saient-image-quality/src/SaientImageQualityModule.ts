import { NativeModule, requireOptionalNativeModule } from "expo";

export type NativeImageQuality = {
  width: number;
  height: number;
  brightness: number;
  contrast: number;
  sharpness: number;
  darkFraction: number;
  brightFraction: number;
};

declare class SaientImageQualityModule extends NativeModule<{}> {
  analyze(base64: string): Promise<NativeImageQuality>;
}

export default requireOptionalNativeModule<SaientImageQualityModule>("SaientImageQuality");
