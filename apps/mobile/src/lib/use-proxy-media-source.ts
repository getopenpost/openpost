import { useEffect, useEffectEvent, useState } from "react";
import type { MediaSource } from "./media-source";
import { downloadProxyMedia, hasProxyMediaHeaders, type TemporaryMedia } from "./proxy-media";

export function useProxyMediaSource(
  source: MediaSource | null,
  onError?: () => void,
): {
  source: MediaSource | null;
  failed: boolean;
} {
  const reportError = useEffectEvent(() => onError?.());
  const protectedByProxy = hasProxyMediaHeaders(source);
  const key = JSON.stringify(source);
  const [identity, setIdentity] = useState({ key, generation: 0 });
  let generation = identity.generation;
  if (identity.key !== key) {
    generation += 1;
    setIdentity({ key, generation });
  }
  const [download, setDownload] = useState<{ generation: number; uri?: string; failed: boolean }>();
  useEffect(() => {
    if (!source || !protectedByProxy) return;
    const controller = new AbortController();
    let temporary: TemporaryMedia | undefined;
    void downloadProxyMedia(source, controller.signal)
      .then((result) => {
        temporary = result;
        if (controller.signal.aborted) result.dispose();
        else setDownload({ generation, uri: result.uri, failed: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setDownload({ generation, failed: true });
          reportError();
        }
      });
    return () => {
      controller.abort();
      temporary?.dispose();
    };
    // The complete source, including credentials, owns the download lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, generation, protectedByProxy]);
  if (!protectedByProxy) return { source, failed: false };
  if (download?.generation !== generation) return { source: null, failed: false };
  return { source: download.uri ? { uri: download.uri } : null, failed: download.failed };
}
