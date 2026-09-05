import { NativeModule, requireOptionalNativeModule } from "expo-modules-core";
import { findNodeHandle, Platform, TextInput } from "react-native";
import { useEffect, useRef, type RefObject } from "react";

import {
  pendingAttachmentFromRichContentImage,
  type RichContentImagePayload,
} from "./rich-content";

type RichContentErrorPayload = {
  viewTag?: number;
  message?: string;
};

type RichContentEvents = {
  onImageReceived: (event: RichContentImagePayload & { viewTag?: number }) => void;
  onImageError: (event: RichContentErrorPayload) => void;
};

declare class OpenPostRichContentModule extends NativeModule<RichContentEvents> {
  registerTextInput(viewTag: number): Promise<void>;
  unregisterTextInput(viewTag: number): Promise<void>;
}

const richContentModule =
  Platform.OS === "android"
    ? requireOptionalNativeModule<OpenPostRichContentModule>("OpenPostRichContent")
    : null;

export type AndroidImageKeyboardContext = {
  focus: () => void;
};

export type AndroidImageKeyboardOptions = {
  onImageReceived: (
    attachment: NonNullable<ReturnType<typeof pendingAttachmentFromRichContentImage>>,
    context: AndroidImageKeyboardContext,
  ) => void;
  onError?: (message: string, context: AndroidImageKeyboardContext) => void;
};

export function useAndroidImageKeyboard(
  inputRef: RefObject<TextInput | null>,
  options?: AndroidImageKeyboardOptions,
): void {
  const optionsRef = useRef(options);
  const enabled = options !== undefined;

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    if (!enabled || Platform.OS !== "android" || !richContentModule) return;

    const viewTag = findNodeHandle(inputRef.current);
    if (viewTag === null) return;

    const context = (): AndroidImageKeyboardContext => ({
      focus: () => inputRef.current?.focus(),
    });
    const receivedSubscription = richContentModule.addListener("onImageReceived", (event) => {
      if (event.viewTag !== viewTag) return;
      const attachment = pendingAttachmentFromRichContentImage(event);
      if (!attachment) {
        optionsRef.current?.onError?.(
          "Could not attach that image. Try copying it again.",
          context(),
        );
        return;
      }
      optionsRef.current?.onImageReceived(attachment, context());
    });
    const errorSubscription = richContentModule.addListener("onImageError", (event) => {
      if (event.viewTag !== viewTag) return;
      optionsRef.current?.onError?.(
        event.message ?? "Could not read that image. Try copying it again.",
        context(),
      );
    });

    void richContentModule.registerTextInput(viewTag);
    return () => {
      receivedSubscription.remove();
      errorSubscription.remove();
      void richContentModule.unregisterTextInput(viewTag);
    };
  }, [enabled, inputRef]);
}
