import { useEffect, useEffectEvent, useId, useMemo, useRef, useState } from "react";
import { PixelRatio, Platform, View } from "react-native";
import Svg, { Rect, Text, Image as SVGImage } from "react-native-svg";
import * as FileSystem from "expo-file-system/legacy";
import type { ScreenshotDocument } from "@openpost/query-catalog";
import { MediaImage } from "./media-image";
import { BodyText, Button } from "./ui";
import { screenshotLayout } from "@/lib/ideate/screenshot-layout";
import { previewMeme, type ExportVisual } from "@/lib/ideate/visual";
import { getToken } from "@/lib/api/token-store";
import { getServer } from "@/lib/server";
import { downloadProxyMedia, hasProxyMediaHeaders } from "@/lib/proxy-media";
import { mediaImageSource } from "@/lib/media-source";

export function IdeateVisual({
  workspaceId,
  document,
  altText,
  onReady,
  onError,
}: {
  workspaceId: string;
  document: ScreenshotDocument;
  altText?: string;
  onReady: (exporter?: ExportVisual) => void;
  onError?: (message: string) => void;
}) {
  const svg = useRef<Svg | null>(null);
  const instanceId = useId().replace(/[^a-z0-9]/gi, "");
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{
    signature: string;
    meme?: string;
    images: Record<string, string>;
  }>();
  const [error, setError] = useState("");
  const signature = JSON.stringify([workspaceId, document]);
  const layoutResult = useMemo(() => {
    try {
      return document.meme ? {} : { layout: screenshotLayout(document) };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : "Could not render this visual" };
    }
  }, [document]);
  const reportReady = useEffectEvent(onReady);
  const reportError = useEffectEvent((message: string) => onError?.(message));
  useEffect(() => {
    const controller = new AbortController();
    reportReady(undefined);
    void (async () => {
      if (layoutResult.error) throw new Error(layoutResult.error);
      if (document.meme) {
        const meme = await previewMeme(workspaceId, document, controller.signal);
        if (!controller.signal.aborted) setLoaded({ signature, meme, images: {} });
        return;
      }
      const images: Record<string, string> = {};
      const ids = [
        ...new Set(
          (layoutResult.layout?.elements ?? []).flatMap((element) =>
            element.kind === "image" ? [element.mediaId] : [],
          ),
        ),
      ];
      for (const id of ids) {
        const server = getServer();
        const source = mediaImageSource(
          `/media/${id}`,
          server?.baseUrl ?? "",
          getToken(),
          server?.headers,
        );
        const file = `${FileSystem.cacheDirectory}ideate-image-${instanceId}-${attempt}-${id}.image`;
        try {
          const protectedByProxy = hasProxyMediaHeaders(source);
          const temporary = protectedByProxy
            ? await downloadProxyMedia(source, controller.signal)
            : undefined;
          try {
            const download = temporary
              ? undefined
              : await FileSystem.downloadAsync(source.uri, file, {
                  headers: source.headers,
                });
            if (download && download.status !== 200)
              throw new Error("Could not load a visual attachment.");
            const bytes = await FileSystem.readAsStringAsync(temporary?.uri ?? file, {
              encoding: FileSystem.EncodingType.Base64,
            });
            const contentType =
              temporary?.contentType ??
              download?.headers["Content-Type"] ??
              download?.headers["content-type"] ??
              "image/png";
            images[id] = `data:${contentType};base64,${bytes}`;
          } finally {
            temporary?.dispose();
          }
        } finally {
          await FileSystem.deleteAsync(file, { idempotent: true });
        }
        if (controller.signal.aborted) return;
      }
      if (!controller.signal.aborted) setLoaded({ signature, images });
    })().catch((cause) => {
      if (!controller.signal.aborted) {
        const message = cause instanceof Error ? cause.message : "Could not render this visual";
        setError(message);
        reportError(message);
      }
    });
    return () => {
      controller.abort();
      reportReady(undefined);
    };
  }, [signature, attempt, workspaceId, document, layoutResult, instanceId]);
  useEffect(() => {
    if (loaded?.signature !== signature) return;
    const exporter: ExportVisual = async () => {
      if (loaded.meme) return { base64: loaded.meme, document };
      const element = svg.current;
      if (!element) throw new Error("This visual is not ready yet.");
      // UIKit exports screen points; Android exports bitmap pixels.
      const exportScale = Platform.OS === "ios" ? PixelRatio.get() : 1;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("This visual could not be exported. Try again.")),
          10000,
        );
        element.toDataURL(
          (base64) => {
            clearTimeout(timeout);
            resolve({ base64, document });
          },
          {
            width: Math.round(1080 / exportScale),
            height: Math.round(((layoutResult.layout?.height ?? 540) * 2) / exportScale),
          },
        );
      });
    };
    // Wait until the current SVG and embedded data images have crossed the native bridge.
    const frame = requestAnimationFrame(() => reportReady(exporter));
    return () => {
      cancelAnimationFrame(frame);
      reportReady(undefined);
    };
  }, [loaded, signature, document, layoutResult]);
  if (error || layoutResult.error)
    return (
      <View style={{ gap: 8 }}>
        <BodyText accessibilityRole="alert">{error || layoutResult.error}</BodyText>
        <Button
          title="Retry visual"
          intent="quiet"
          onPress={() => {
            setError("");
            setAttempt((value) => value + 1);
          }}
        />
      </View>
    );
  if (loaded?.signature !== signature)
    return <BodyText accessibilityLiveRegion="polite">Rendering visual…</BodyText>;
  if (loaded.meme)
    return (
      <MediaImage
        uri={`data:image/png;base64,${loaded.meme}`}
        contentFit="contain"
        style={{ width: "100%", aspectRatio: 1 }}
        accessibilityLabel={altText || document.title}
      />
    );
  const layout = layoutResult.layout;
  if (!layout) return null;
  return (
    <View style={{ width: "100%", aspectRatio: 540 / layout.height }}>
      <Svg
        ref={svg}
        width="100%"
        height="100%"
        viewBox={`0 0 540 ${layout.height}`}
        accessibilityLabel={altText || document.title}
        accessible
      >
        <Rect width={540} height={layout.height} fill={layout.background} />
        {layout.elements.map((element, index) =>
          element.kind === "rect" ? (
            <Rect
              key={index}
              x={element.x}
              y={element.y}
              width={element.width}
              height={element.height}
              rx={element.radius}
              fill={element.color}
            />
          ) : element.kind === "image" ? (
            <SVGImage
              key={index}
              x={element.x}
              y={element.y}
              width={element.width}
              height={element.height}
              href={loaded.images[element.mediaId]}
              preserveAspectRatio="xMidYMid meet"
            />
          ) : (
            <Text
              key={index}
              x={element.x}
              y={element.y}
              fontSize={element.size}
              fill={element.color}
              fontWeight={element.weight}
              textAnchor={element.anchor}
              fontFamily={element.mono ? "Courier" : "Arial"}
            >
              {element.value}
            </Text>
          ),
        )}
      </Svg>
    </View>
  );
}
