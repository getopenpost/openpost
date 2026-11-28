import { useEffect, useEffectEvent, useState } from "react";
import { View } from "react-native";
import type { ScreenshotDocument } from "@openpost/query-catalog";
import { MediaImage } from "./media-image";
import { BodyText, Button } from "./ui";
import { previewMeme, previewTemplate, type ExportVisual } from "@/lib/ideate/visual";

type Loaded = {
  signature: string;
  base64: string;
  mime: "png" | "jpeg";
  aspectRatio: number;
};

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
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded>();
  const [error, setError] = useState("");
  const signature = JSON.stringify([workspaceId, document]);
  const reportReady = useEffectEvent(onReady);
  const reportError = useEffectEvent((message: string) => onError?.(message));
  useEffect(() => {
    const controller = new AbortController();
    reportReady(undefined);
    void (async () => {
      if (document.meme) {
        const base64 = await previewMeme(workspaceId, document, controller.signal);
        if (!controller.signal.aborted)
          setLoaded({ signature, base64, mime: "png", aspectRatio: 1 });
        return;
      }
      const preview = await previewTemplate(workspaceId, document, controller.signal);
      if (!controller.signal.aborted)
        setLoaded({
          signature,
          base64: preview.base64,
          mime: "jpeg",
          aspectRatio: preview.width / preview.height,
        });
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
    // The document is keyed by its JSON so an identical document is not re-requested.
  }, [signature, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (loaded?.signature !== signature) return;
    const exporter: ExportVisual = async () => ({
      document,
    });
    reportReady(exporter);
    return () => reportReady(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, signature]);
  if (error)
    return (
      <View style={{ gap: 8 }}>
        <BodyText accessibilityRole="alert">{error}</BodyText>
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
  return (
    <MediaImage
      uri={`data:image/${loaded.mime};base64,${loaded.base64}`}
      contentFit="contain"
      style={{ width: "100%", aspectRatio: loaded.aspectRatio }}
      accessibilityLabel={altText || document.title}
    />
  );
}
