<script lang="ts">
  import PreviewDocument from "./PreviewDocument.svelte";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import FileText from "@lucide/svelte/icons/file-text";
  import Play from "@lucide/svelte/icons/play";
  import type { PreviewMedia } from "./model";

  type Layout =
    | "grid"
    | "carousel"
    | "facebook"
    | "single"
    | "discord"
    | "album"
    | "document";

  interface Props {
    media: PreviewMedia[];
    layout?: Layout;
    class?: string;
    emptyLabel?: string;
  }

  let {
    media,
    layout = "grid",
    class: className = "",
    emptyLabel = "",
  }: Props = $props();
  const MAX_VISIBLE_POSITION_DOTS = 5;
  let currentIndex = $state(0);
  let measuredRatios = $state<Record<string, number>>({});

  function aspectRatio(item: PreviewMedia | undefined): number | undefined {
    if (!item) return undefined;
    return item.aspectRatio && item.aspectRatio > 0
      ? item.aspectRatio
      : measuredRatios[item.src];
  }

  function measure(item: PreviewMedia, width: number, height: number) {
    if (width > 0 && height > 0) measuredRatios[item.src] = width / height;
  }

  const safeIndex = $derived(
    Math.min(currentIndex, Math.max(0, media.length - 1)),
  );
  const active = $derived(media[safeIndex]);
  const positionStart = $derived(
    Math.max(
      0,
      Math.min(
        safeIndex - Math.floor(MAX_VISIBLE_POSITION_DOTS / 2),
        media.length - MAX_VISIBLE_POSITION_DOTS,
      ),
    ),
  );
  const visiblePositions = $derived(
    media.slice(positionStart, positionStart + MAX_VISIBLE_POSITION_DOTS),
  );
  const visibleGridMedia = $derived(media.slice(0, 4));
  const visibleFacebookMedia = $derived(media.slice(0, 5));
  const galleryMedia = $derived(
    media.filter((item) => item.kind !== "document"),
  );
  const documents = $derived(media.filter((item) => item.kind === "document"));
  const gridCount = $derived(Math.min(media.length, 4));
  const facebookCount = $derived(Math.min(media.length, 5));

  function go(delta: number) {
    currentIndex = Math.min(Math.max(safeIndex + delta, 0), media.length - 1);
  }
</script>

{#snippet mediaTile(item: PreviewMedia, extraClass = "", overflow = 0)}
  <div
    class={["media-tile", `kind-${item.kind}`, extraClass]}
    style:--media-ratio={aspectRatio(item) ?? 16 / 9}
  >
    {#if item.kind === "video"}
      <video
        src={item.src}
        poster={item.poster}
        aria-label={item.alt || "Video preview"}
        muted
        playsinline
        preload="metadata"
        onloadedmetadata={(event) =>
          measure(
            item,
            event.currentTarget.videoWidth,
            event.currentTarget.videoHeight,
          )}
      ></video>
      <span class="video-play" aria-hidden="true"
        ><Play fill="currentColor" /></span
      >
      {#if item.durationLabel}<span class="duration">{item.durationLabel}</span
        >{/if}
    {:else if item.kind === "document"}
      <PreviewDocument media={item} />
    {:else}
      <img
        src={item.src}
        alt={item.alt || ""}
        onload={(event) => {
          const image = event.currentTarget as HTMLImageElement;
          measure(item, image.naturalWidth, image.naturalHeight);
        }}
      />
    {/if}
    {#if overflow > 0}<span class="overflow-count">+{overflow}</span>{/if}
  </div>
{/snippet}

{#if media.length === 0}
  {#if emptyLabel}
    <div class={["empty-media", className]} role="img" aria-label={emptyLabel}>
      <Play aria-hidden="true" />
      <span>{emptyLabel}</span>
    </div>
  {/if}
{:else if layout === "carousel" && active}
  <div
    class={["media-carousel", className]}
    style:--carousel-ratio={Math.max(
      0.75,
      Math.min(1.91, aspectRatio(media[0]) ?? 1),
    )}
  >
    {@render mediaTile(active, "carousel-tile")}
    {#if media.length > 1}
      <span class="carousel-count">{safeIndex + 1}/{media.length}</span>
      {#if safeIndex > 0}
        <button
          type="button"
          class="carousel-button previous"
          aria-label="Previous media"
          onclick={() => go(-1)}
        >
          <ChevronLeft />
        </button>
      {/if}
      {#if safeIndex < media.length - 1}
        <button
          type="button"
          class="carousel-button next"
          aria-label="Next media"
          onclick={() => go(1)}
        >
          <ChevronRight />
        </button>
      {/if}
      <div class="carousel-dots" aria-label="Media position">
        {#each visiblePositions as item, offset (item.id)}
          {@const index = positionStart + offset}
          <button
            type="button"
            aria-label={`Show media ${index + 1}`}
            aria-current={index === safeIndex ? "true" : undefined}
            onclick={() => (currentIndex = index)}
          >
            <span></span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
{:else if layout === "discord" || layout === "album"}
  <div class={["attachment-gallery", `layout-${layout}`, className]}>
    {#if galleryMedia.length}
      <div class="mosaic" class:single={galleryMedia.length === 1}>
        {#each galleryMedia as item (item.id)}{@render mediaTile(item)}{/each}
      </div>
    {/if}
    {#each documents as item (item.id)}
      <div class="file-attachment">
        <FileText aria-hidden="true" />
        <div>
          <strong>{item.alt || "Document"}</strong><span>File attachment</span>
        </div>
      </div>
    {/each}
  </div>
{:else if layout === "facebook"}
  <div class={["facebook-media", `count-${facebookCount}`, className]}>
    {#each visibleFacebookMedia as item, index (item.id)}
      {@render mediaTile(
        item,
        `tile-${index + 1}`,
        index === visibleFacebookMedia.length - 1
          ? Math.max(0, media.length - 5)
          : 0,
      )}
    {/each}
  </div>
{:else if layout === "grid"}
  <div class={["media-grid", `count-${gridCount}`, className]}>
    {#each visibleGridMedia as item, index (item.id)}
      {@render mediaTile(
        item,
        `tile-${index + 1}`,
        index === visibleGridMedia.length - 1
          ? Math.max(0, media.length - 4)
          : 0,
      )}
    {/each}
  </div>
{:else if active}
  <div class={["single-media", `layout-${layout}`, className]}>
    {@render mediaTile(active, layout === "document" ? "document-tile" : "")}
  </div>
{/if}

<style>
  .media-carousel,
  .media-grid,
  .facebook-media,
  .single-media {
    position: relative;
    width: 100%;
    overflow: hidden;
    background: #0f0f0f;
  }

  .media-tile {
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: #16181c;
  }

  .media-tile img,
  .media-tile video {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .single-media img,
  .single-media video,
  .media-grid.count-1 img,
  .media-grid.count-1 video,
  .facebook-media.count-1 img,
  .facebook-media.count-1 video {
    object-fit: contain;
  }

  .media-tile.kind-video {
    background: #000;
  }

  .video-play {
    position: absolute;
    top: 50%;
    left: 50%;
    display: grid;
    width: 3rem;
    height: 3rem;
    translate: -50% -50%;
    place-items: center;
    border-radius: 50%;
    background: rgb(0 0 0 / 62%);
    color: white;
    pointer-events: none;
  }

  .video-play :global(svg) {
    width: 1.35rem;
    height: 1.35rem;
    margin-left: 0.15rem;
  }

  .duration,
  .carousel-count {
    position: absolute;
    z-index: 2;
    top: 0.7rem;
    right: 0.7rem;
    border-radius: 0.35rem;
    background: rgb(0 0 0 / 70%);
    color: white;
    padding: 0.18rem 0.42rem;
    font-size: 0.7rem;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
  }

  .duration {
    top: auto;
    bottom: 0.6rem;
  }

  .media-carousel .carousel-tile {
    aspect-ratio: var(--carousel-ratio, 1);
  }

  .carousel-button {
    position: absolute;
    z-index: 3;
    top: 50%;
    display: grid;
    width: 2.5rem;
    height: 2.5rem;
    translate: 0 -50%;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: rgb(255 255 255 / 88%);
    color: #161616;
    cursor: pointer;
  }

  .carousel-button.previous {
    left: 0.6rem;
  }

  .carousel-button.next {
    right: 0.6rem;
  }

  .carousel-button:focus-visible,
  .carousel-dots button:focus-visible {
    outline: 2px solid #0095f6;
    outline-offset: 2px;
  }

  .carousel-button :global(svg) {
    width: 1.2rem;
    height: 1.2rem;
  }

  .carousel-dots {
    position: absolute;
    z-index: 3;
    right: 0;
    bottom: 0.35rem;
    left: 0;
    display: flex;
    justify-content: center;
  }

  .carousel-dots button {
    display: grid;
    width: 1.15rem;
    height: 1.6rem;
    place-items: center;
    border: 0;
    background: transparent;
    padding: 0;
    cursor: pointer;
  }

  .carousel-dots span {
    width: 0.38rem;
    height: 0.38rem;
    border-radius: 50%;
    background: rgb(255 255 255 / 68%);
  }

  .carousel-dots [aria-current="true"] span {
    background: #0095f6;
  }

  .media-grid {
    display: grid;
    gap: 2px;
    border-radius: 1rem;
  }

  .media-grid.count-1 {
    grid-template-columns: 1fr;
  }

  .media-grid.count-1 .media-tile {
    aspect-ratio: var(--media-ratio);
    max-height: 34rem;
  }

  .media-grid.count-2 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    aspect-ratio: 16 / 9;
  }

  .media-grid.count-3 {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: repeat(2, minmax(0, 1fr));
    aspect-ratio: 16 / 9;
  }

  .media-grid.count-3 .tile-1 {
    grid-row: 1 / 3;
  }

  .media-grid.count-4 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: repeat(2, minmax(0, 1fr));
    aspect-ratio: 16 / 9;
  }

  .facebook-media {
    display: grid;
    gap: 2px;
    border-radius: 0;
    background: #fff;
  }

  .facebook-media.count-1 .media-tile {
    aspect-ratio: var(--media-ratio);
    max-height: 36rem;
  }

  .facebook-media.count-2 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    aspect-ratio: 1.4;
  }

  .facebook-media.count-3 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: 1.15fr 1fr;
    aspect-ratio: 1;
  }

  .facebook-media.count-3 .tile-1 {
    grid-column: 1 / 3;
  }

  .facebook-media.count-4,
  .facebook-media.count-5 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: repeat(2, minmax(0, 1fr));
    aspect-ratio: 1;
  }

  .facebook-media.count-5 {
    grid-template-columns: repeat(6, minmax(0, 1fr));
    grid-template-rows: repeat(2, minmax(0, 1fr));
  }

  .facebook-media.count-5 .media-tile {
    grid-column: span 2;
  }

  .facebook-media.count-5 .tile-1,
  .facebook-media.count-5 .tile-2 {
    grid-column: span 3;
  }

  .overflow-count {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgb(0 0 0 / 48%);
    color: white;
    font-size: 2rem;
    font-weight: 600;
  }

  .single-media .media-tile {
    aspect-ratio: var(--media-ratio);
    max-height: 36rem;
  }

  .single-media.layout-discord {
    width: min(100%, 32rem);
    border-radius: 0.5rem;
  }

  .empty-media {
    display: grid;
    min-height: 18rem;
    place-items: center;
    align-content: center;
    gap: 0.8rem;
    background: #0f0f0f;
    color: #fff;
    text-align: center;
  }

  .empty-media :global(svg) {
    width: 3rem;
    height: 3rem;
    stroke-width: 1.5;
  }

  .empty-media span {
    font-size: 0.82rem;
  }

  @media (pointer: coarse) {
    .carousel-button {
      width: 2.75rem;
      height: 2.75rem;
    }
  }
  .attachment-gallery {
    display: grid;
    gap: 0.35rem;
    margin-top: 0.5rem;
    width: min(100%, 32rem);
  }
  .mosaic {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 3px;
    overflow: hidden;
    border-radius: 0.5rem;
  }
  .mosaic .media-tile {
    aspect-ratio: 1;
  }
  .mosaic.single {
    grid-template-columns: 1fr;
  }
  .mosaic.single .media-tile {
    aspect-ratio: var(--media-ratio);
    max-height: 32rem;
  }
  .mosaic:not(.single) .media-tile:first-child:nth-last-child(odd) {
    grid-column: 1 / -1;
    aspect-ratio: 2;
  }
  .file-attachment {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    border: 1px solid var(--native-border, #d8dde1);
    border-radius: 0.5rem;
    padding: 0.75rem;
    background: var(--native-soft, #f1f5f7);
    color: var(--native-fg, #18242b);
  }
  .file-attachment > :global(svg) {
    width: 1.8rem;
    height: 1.8rem;
    flex: none;
    color: light-dark(#2678a7, #6bb6ed);
  }
  .file-attachment > div {
    display: grid;
    min-width: 0;
    gap: 0.2rem;
  }
  .file-attachment strong {
    font-size: 0.82rem;
    overflow-wrap: anywhere;
  }
  .file-attachment span {
    color: var(--native-muted, #52636b);
    font-size: 0.72rem;
  }
  @media (pointer: coarse) {
    .carousel-dots button {
      flex-shrink: 0;
      min-width: 44px;
      width: 44px;
      height: 44px;
    }
    .carousel-dots {
      overflow-x: auto;
      justify-content: safe center;
    }
  }
  .media-tile.kind-document {
    aspect-ratio: auto;
    max-height: none;
  }
</style>
