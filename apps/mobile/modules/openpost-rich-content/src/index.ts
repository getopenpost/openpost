import { NativeModule, requireOptionalNativeModule } from "expo-modules-core";

declare class OpenPostRichContentModule extends NativeModule {
  registerTextInput(viewTag: number): Promise<void>;
  unregisterTextInput(viewTag: number): Promise<void>;
}

export default requireOptionalNativeModule<OpenPostRichContentModule>("OpenPostRichContent");
