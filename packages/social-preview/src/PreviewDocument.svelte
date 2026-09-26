<script lang="ts">
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import type {
    PDFDocumentLoadingTask,
    PDFDocumentProxy,
    RenderTask,
  } from "pdfjs-dist";
  import type { PreviewMedia } from "./model";

  let { media }: { media: PreviewMedia } = $props();
  let document = $state.raw<PDFDocumentProxy | null>(null);
  let canvas = $state<HTMLCanvasElement>();
  let width = $state(320);
  let pageNumber = $state(1);
  let retry = $state(0);
  let loading = $state(true);
  let rendering = $state(false);
  let loadError = $state("");
  let renderError = $state("");
  let pageText = $state("");

  $effect(() => {
    const source = media.src;
    retry;
    let disposed = false;
    let task: PDFDocumentLoadingTask | undefined;
    document = null;
    pageNumber = 1;
    loadError = "";
    loading = true;
    rendering = false;
    renderError = "";
    pageText = "";

    void (async () => {
      try {
        const [pdfjs, worker] = await Promise.all([
          import("pdfjs-dist"),
          import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
        ]);
        if (disposed) return;
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const resources = new URL(
          `/pdfjs/${pdfjs.version}/`,
          window.location.origin,
        ).href;
        task = pdfjs.getDocument({
          cMapUrl: `${resources}cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${resources}standard_fonts/`,
          wasmUrl: `${resources}wasm/`,
          url: source,
          withCredentials:
            new URL(source, window.location.href).origin ===
            window.location.origin,
          isEvalSupported: false,
          useSystemFonts: true,
          stopAtErrors: true,
        });
        task.onPassword = () => {
          if (!disposed)
            loadError =
              "This document needs a password. Upload an unlocked PDF to preview it.";
          void task?.destroy().catch(() => {});
        };
        const loaded = await task.promise;
        if (disposed) return;
        document = loaded;
      } catch {
        if (!disposed && !loadError)
          loadError =
            "The document could not load. Check the file and its access permissions, then try again.";
      } finally {
        if (!disposed) loading = false;
      }
    })();

    return () => {
      disposed = true;
      void task?.destroy().catch(() => {});
    };
  });

  $effect(() => {
    const pdf = document;
    const target = canvas;
    const selectedPage = pageNumber;
    const availableWidth = width;
    if (!pdf || !target || availableWidth <= 0) return;
    let disposed = false;
    let task: RenderTask | undefined;
    rendering = true;
    renderError = "";
    pageText = "";

    void (async () => {
      const page = await pdf.getPage(selectedPage);
      if (disposed) return;
      try {
        const natural = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({
          scale: Math.min(availableWidth, 900) / natural.width,
        });
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        target.width = Math.ceil(viewport.width * pixelRatio);
        target.height = Math.ceil(viewport.height * pixelRatio);
        task = page.render({
          canvas: target,
          viewport,
          transform:
            pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
        });
        const [, text] = await Promise.all([
          task.promise,
          page.getTextContent(),
        ]);
        if (!disposed)
          pageText = text.items
            .map((item) => ("str" in item ? item.str : ""))
            .filter(Boolean)
            .join(" ");
      } finally {
        page.cleanup();
      }
    })()
      .catch(() => {
        if (!disposed)
          renderError =
            "This page could not render. Try another page or upload a new PDF.";
      })
      .finally(() => {
        if (!disposed) rendering = false;
      });

    return () => {
      disposed = true;
      task?.cancel();
    };
  });
</script>

<div
  class="document-preview"
  aria-label={media.alt || "Document preview"}
  role="region"
>
  <div
    class="document-page"
    bind:clientWidth={width}
    aria-busy={loading || rendering}
  >
    <div
      class="page-image"
      class:pending={loading || rendering || Boolean(loadError || renderError)}
      role="img"
      aria-label={`Document page ${pageNumber}`}
    >
      <canvas bind:this={canvas} aria-hidden="true"></canvas>
    </div>
    {#if loadError || renderError}
      <div class="document-notice">
        <p role="alert">{loadError || renderError}</p>
        <button type="button" onclick={() => (retry += 1)}>Try again</button>
      </div>
    {:else if loading || rendering}
      <p class="document-notice" role="status">Loading document…</p>
    {/if}
    {#if pageText}<p class="sr-only">{pageText}</p>{/if}
  </div>
  <footer>
    <strong>{media.alt || "Document"}</strong>
    {#if document}
      <div class="page-controls">
        <button
          type="button"
          aria-label="Previous page"
          disabled={pageNumber === 1}
          onclick={() => (pageNumber -= 1)}><ChevronLeft /></button
        >
        <span aria-live="polite">{pageNumber} / {document.numPages}</span>
        <button
          type="button"
          aria-label="Next page"
          disabled={pageNumber === document.numPages}
          onclick={() => (pageNumber += 1)}><ChevronRight /></button
        >
      </div>
    {:else}<span>PDF</span>{/if}
  </footer>
</div>

<style>
  .document-preview {
    width: 100%;
    background: light-dark(#e9e8e5, #25292c);
    color: var(--native-fg, #222);
  }
  .document-page {
    position: relative;
    min-height: 14rem;
    width: 100%;
    background: #fff;
  }
  canvas {
    display: block;
    width: 100%;
    height: auto;
    background: #fff;
  }
  .page-image.pending {
    visibility: hidden;
  }
  .document-notice {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 0.65rem;
    margin: 0;
    padding: 1.25rem;
    color: #353535;
    font:
      0.85rem/1.5 -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      sans-serif;
    text-align: center;
  }
  .document-notice p {
    margin: 0;
  }
  button {
    display: inline-grid;
    flex: none;
    min-width: 2rem;
    min-height: 2rem;
    place-items: center;
    border: 1px solid light-dark(#999, #73797e);
    border-radius: 999px;
    padding: 0.3rem;
    background: light-dark(#fff, #30363b);
    color: var(--native-fg, #222);
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  button:focus-visible {
    outline: 2px solid light-dark(#0a66c2, #70b5f9);
    outline-offset: 2px;
  }
  .document-notice button {
    border-radius: 0.4rem;
    padding: 0.35rem 0.75rem;
    background: #fff;
    color: #222;
  }
  button :global(svg) {
    width: 1rem;
    height: 1rem;
  }
  footer {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: 0.65rem;
    padding: 0.65rem 0.85rem;
    font-size: 0.75rem;
  }
  footer strong {
    min-width: 0;
    overflow-wrap: anywhere;
    font-weight: 600;
  }
  .page-controls {
    display: flex;
    flex: none;
    align-items: center;
    gap: 0.45rem;
    font-variant-numeric: tabular-nums;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  @media (pointer: coarse) {
    button {
      min-width: 44px;
      min-height: 44px;
    }
  }
</style>
