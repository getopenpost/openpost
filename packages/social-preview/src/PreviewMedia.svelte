<script lang="ts">
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import FileText from "@lucide/svelte/icons/file-text";
  import Play from "@lucide/svelte/icons/play";
  import type { PreviewMedia } from "./model";

  type Layout =
    "grid" | "carousel" | "facebook" | "single" | "discord" | "document";

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
  let currentIndex = $state(0);

  const safeIndex = $derived(
    Math.min(currentIndex, Math.max(0, media.length - 1)),
  );
  const active = $derived(media[safeIndex]);
  const visibleGridMedia = $derived(media.slice(0, 4));
  const visibleFacebookMedia = $derived(media.slice(0, 5));
  const gridCount = $derived(Math.min(media.length, 4));
  const facebookCount = $derived(Math.min(media.length, 5));

  function go(delta: number) {
    currentIndex = Math.min(Math.max(safeIndex + delta, 0), media.length - 1);
  }
</script>

{#snippet mediaTile(item: PreviewMedia, extraClass = "", overflow = 0)}
  <div
    class={["media-tile", `kind-${item.kind}`, extraClass]}
    style:--media-ratio={item.aspectRatio ?? 16 / 9}
  >
    {#if item.kind === "video"}
      <video
        src={item.src}
        poster={item.poster}
        aria-label={item.alt || "Video preview"}
        muted
        playsinline
        preload="metadata"
      ></video>
      <span class="video-play" aria-hidden="true"
        ><Play fill="currentColor" /></span
      >
      {#if item.durationLabel}<span class="duration">{item.durationLabel}</span
        >{/if}
    {:else if item.kind === "document"}
      <div class="document-page">
        <FileText aria-hidden="true" />
        <strong>{item.alt || "Document preview"}</strong>
        <span>PDF</span>
      </div>
    {:else}
      <img src={item.src} alt={item.alt || ""} />
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
  <div class={["media-carousel", className]}>
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
        {#each media as item, index (item.id)}
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
    aspect-ratio: 1;
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

  .document-page {
    display: grid;
    height: 100%;
    min-height: 19rem;
    place-items: center;
    align-content: center;
    gap: 0.8rem;
    background:
      linear-gradient(90deg, #f3f2ef 2.2rem, transparent 2.2rem),
      repeating-linear-gradient(#fff 0 1.5rem, #e6e3df 1.5rem 1.55rem);
    color: #232323;
    padding: 3rem;
    text-align: center;
  }

  .document-page :global(svg) {
    width: 2.4rem;
    height: 2.4rem;
    color: #0a66c2;
  }

  .document-page strong {
    max-width: 25ch;
    font-size: 1.15rem;
    line-height: 1.3;
  }

  .document-page span {
    color: #666;
    font-size: 0.72rem;
    font-weight: 700;
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

  @media (max-width: 32rem) {
    .carousel-button {
      width: 2.75rem;
      height: 2.75rem;
    }

    .document-page {
      min-height: 14rem;
    }
  }
</style>
