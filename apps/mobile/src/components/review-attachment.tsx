import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import type { components } from "@openpost/api-contract";
import { getToken, getTokenMutationRevision, subscribeToken } from "@/lib/api/token-store";
import { getServer, getServerMutationRevision, subscribeServer } from "@/lib/server";
import { mediaImageSource } from "@/lib/media-source";
import { captureApiRequestIdentity, apiRequestIdentityIsCurrent } from "@/lib/api/client";
import { useProxyMediaSource } from "@/lib/use-proxy-media-source";
import { downloadProxyMedia, hasProxyMediaHeaders, type TemporaryMedia } from "@/lib/proxy-media";
import { BodyText, Button } from "./ui";
import { QueryNotice } from "./query-state";
import { MediaImage } from "./media-image";

type Media = components["schemas"]["MediaSummary"];
export function ReviewAttachment({ media }: { media: Media }) {
  const server = useSyncExternalStore(subscribeServer, getServer);
  const token = useSyncExternalStore(subscribeToken, getToken);
  const source = mediaImageSource(media.url, server?.baseUrl ?? "", token, server?.headers);
  if (media.mime_type.startsWith("image/"))
    return (
      <MediaImage
        uri={media.url}
        accessibilityLabel={media.alt_text || "Submitted image"}
        contentFit="contain"
        style={{ width: "100%", aspectRatio: media.height ? media.width / media.height : 1 }}
      />
    );
  if (media.mime_type.startsWith("video/") || media.mime_type.startsWith("audio/"))
    return (
      <PlayableAttachment
        key={`${source.uri}:${getTokenMutationRevision()}:${getServerMutationRevision()}`}
        media={media}
        source={source}
      />
    );
  return (
    <OpenAttachment
      key={`${source.uri}:${getTokenMutationRevision()}:${getServerMutationRevision()}`}
      media={media}
      source={source}
    />
  );
}
function PlayableAttachment({
  media,
  source,
}: {
  media: Media;
  source: { uri: string; headers?: Record<string, string> };
}) {
  const proxy = useProxyMediaSource(source);
  if (proxy.failed)
    return (
      <View style={{ gap: 8 }}>
        <QueryNotice message="Could not load this attachment." />
        <OpenAttachment media={media} source={source} />
      </View>
    );
  if (!proxy.source) return <BodyText>Loading attachment…</BodyText>;
  return <ReadyPlayableAttachment media={media} source={proxy.source} />;
}
function ReadyPlayableAttachment({
  media,
  source,
}: {
  media: Media;
  source: { uri: string; headers?: Record<string, string> };
}) {
  const player = useVideoPlayer({ ...source, useCaching: false });
  const { status, error } = useEvent(player, "statusChange", { status: player.status });
  const { isPlaying } = useEvent(player, "playingChange", { isPlaying: player.playing });
  return (
    <View style={{ gap: 8 }}>
      <BodyText selectable>{media.original_filename}</BodyText>
      {media.mime_type.startsWith("video/") ? (
        <VideoView
          accessibilityLabel={media.original_filename || "Submitted video"}
          player={player}
          nativeControls
          contentFit="contain"
          style={{ width: "100%", aspectRatio: media.height ? media.width / media.height : 16 / 9 }}
        />
      ) : (
        <Button
          title={isPlaying ? "Pause audio" : "Play audio"}
          intent="ordinary"
          onPress={() => (isPlaying ? player.pause() : player.play())}
        />
      )}
      {status === "error" ? (
        <QueryNotice
          message={
            error?.message
              ? "Could not play this attachment. Open it in another app."
              : "Could not play this attachment"
          }
        />
      ) : null}
      <OpenAttachment media={media} source={source} />
    </View>
  );
}
function OpenAttachment({
  media,
  source,
}: {
  media: Media;
  source: { uri: string; headers?: Record<string, string> };
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<FileSystem.DownloadResumable | null>(null);
  const mounted = useRef(true);
  const activeAbort = useRef<AbortController | null>(null);
  const sourceHeadersKey = JSON.stringify(source.headers);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void active.current?.cancelAsync();
      activeAbort.current?.abort();
    };
  }, [source.uri, sourceHeadersKey]);
  async function open() {
    if (busy) return;
    const identity = captureApiRequestIdentity();
    const current = () => mounted.current && apiRequestIdentityIsCurrent(identity);
    setBusy(true);
    setError("");
    let local: string | undefined;
    let temporary: TemporaryMedia | undefined;
    try {
      if (!(await Sharing.isAvailableAsync()))
        throw new Error("Opening files is unavailable on this device");
      if (source.uri.startsWith("file://")) {
        await Sharing.shareAsync(source.uri, {
          mimeType: media.mime_type,
          dialogTitle: "Inspect submitted attachment",
        });
        return;
      }
      if (hasProxyMediaHeaders(source)) {
        const controller = new AbortController();
        activeAbort.current = controller;
        temporary = await downloadProxyMedia(source, controller.signal);
        if (!current()) return;
        await Sharing.shareAsync(temporary.uri, {
          mimeType: media.mime_type,
          dialogTitle: "Inspect submitted attachment",
        });
        return;
      }
      if (!FileSystem.cacheDirectory) throw new Error("Temporary storage is unavailable");
      const filename = (media.original_filename || "attachment").replace(/[^a-zA-Z0-9._-]/g, "_");
      local = `${FileSystem.cacheDirectory}review-${Date.now()}-${Math.random().toString(36).slice(2)}-${filename}`;
      const download = FileSystem.createDownloadResumable(source.uri, local, {
        headers: source.headers,
      });
      active.current = download;
      const result = await download.downloadAsync();
      if (!current()) return;
      if (!result || result.status !== 200) throw new Error("Could not download the attachment");
      await Sharing.shareAsync(result.uri, {
        mimeType: media.mime_type,
        dialogTitle: "Inspect submitted attachment",
      });
    } catch (cause) {
      if (current())
        setError(cause instanceof Error ? cause.message : "Could not open the attachment");
    } finally {
      active.current = null;
      activeAbort.current = null;
      temporary?.dispose();
      if (local) await FileSystem.deleteAsync(local, { idempotent: true }).catch(() => undefined);
      if (current()) setBusy(false);
    }
  }
  return (
    <View style={{ gap: 8 }}>
      <Button
        title={busy ? "Opening attachment…" : `Open ${media.original_filename || "attachment"}`}
        intent="quiet"
        disabled={busy}
        onPress={() => void open()}
      />
      {error ? <QueryNotice message={error} /> : null}
    </View>
  );
}
