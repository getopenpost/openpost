import { Image, type ImageProps } from "expo-image";
import { useSyncExternalStore } from "react";
import { getToken, subscribeToken } from "@/lib/api/token-store";
import { getServer, subscribeServer } from "@/lib/server";
import { mediaImageSource } from "@/lib/media-source";

export function MediaImage({
  uri,
  ...props
}: Omit<ImageProps, "source" | "cachePolicy"> & { uri: string }) {
  const server = useSyncExternalStore(subscribeServer, getServer);
  const token = useSyncExternalStore(subscribeToken, getToken);
  const source = mediaImageSource(uri, server?.baseUrl ?? "", token);
  return <Image {...props} source={source} cachePolicy="none" recyclingKey={source.uri} />;
}
