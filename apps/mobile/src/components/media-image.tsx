import { Image, type ImageProps } from "expo-image";
import { useCallback, useState, useSyncExternalStore } from "react";
import { type StyleProp, type ViewStyle, View } from "react-native";
import { getToken, getTokenMutationRevision, subscribeToken } from "@/lib/api/token-store";
import { getServer, getServerMutationRevision, subscribeServer } from "@/lib/server";
import { mediaPreviewCandidates, type MediaPreviewSize } from "@/lib/media-source";
import { useProxyMediaSource } from "@/lib/use-proxy-media-source";
import { useNativeTheme } from "@/theme";

export type { MediaPreviewSize };

type MediaImageProps = Omit<ImageProps, "source" | "cachePolicy" | "onError"> & {
  uri: string;
  size?: MediaPreviewSize;
  onError?: () => void;
};

export function MediaImage({ uri, size = "original", onError, ...props }: MediaImageProps) {
  const placeholderColor = useNativeTheme().manifest.colors.surfaceContainerHigh;
  const server = useSyncExternalStore(subscribeServer, getServer);
  const token = useSyncExternalStore(subscribeToken, getToken);
  const baseUrl = server?.baseUrl ?? "";
  const target = `${size}:${uri}:${getServerMutationRevision()}:${getTokenMutationRevision()}`;
  const [attempt, setAttempt] = useState({ key: target, index: 0, missing: false });
  // Recycled rows reuse this component for a new image; restart the
  // thumbnail-then-original sequence for the new target.
  if (attempt.key !== target) {
    setAttempt({ key: target, index: 0, missing: false });
  }
  const candidates = mediaPreviewCandidates(uri, size, baseUrl, token, server?.headers);
  const source = candidates[Math.min(attempt.index, candidates.length - 1)] ?? { uri };

  const handleError = useCallback(() => {
    if (attempt.missing) return;
    if (attempt.index < candidates.length - 1) {
      setAttempt((current) => ({ ...current, index: current.index + 1 }));
      return;
    }
    setAttempt((current) => ({ ...current, missing: true }));
    onError?.();
  }, [attempt.index, attempt.missing, candidates.length, onError]);
  const proxy = useProxyMediaSource(source, handleError);

  if (attempt.missing || !proxy.source) {
    return (
      <View
        style={[{ backgroundColor: placeholderColor }, props.style] as StyleProp<ViewStyle>}
        accessibilityRole="image"
        accessibilityLabel={
          typeof props.accessibilityLabel === "string"
            ? props.accessibilityLabel
            : "Image unavailable"
        }
        testID={props.testID}
      />
    );
  }

  return (
    <Image
      {...props}
      source={proxy.source}
      // Protected previews must not enter the disk cache.
      cachePolicy="none"
      recyclingKey={source.uri}
      onError={handleError}
    />
  );
}
