<script lang="ts">
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Heart from "@lucide/svelte/icons/heart";
  import MoreHorizontal from "@lucide/svelte/icons/ellipsis";
  import Music2 from "@lucide/svelte/icons/music-2";
  import Play from "@lucide/svelte/icons/play";
  import Send from "@lucide/svelte/icons/send";
  import Volume2 from "@lucide/svelte/icons/volume-2";
  import X from "@lucide/svelte/icons/x";
  import type { PreviewModel, PreviewPlatform } from "./model";
  import PreviewActions from "./PreviewActions.svelte";
  import PreviewAvatar from "./PreviewAvatar.svelte";

  interface Props {
    model: PreviewModel;
    platform: Extract<
      PreviewPlatform,
      "instagram" | "facebook" | "youtube" | "tiktok"
    >;
    compact?: boolean;
  }

  let { model, platform, compact = false }: Props = $props();
  let currentIndex = $state(0);

  const segment = $derived(model.segments[0] ?? { id: "primary", text: "" });
  const media = $derived(segment.media?.length ? segment.media : model.media);
  const safeIndex = $derived(
    Math.min(currentIndex, Math.max(0, media.length - 1)),
  );
  const activeMedia = $derived(media[safeIndex]);
  const handle = $derived(model.identity.handle.replace(/^@/u, ""));
  const isStory = $derived(model.format === "story");
  const playerLabel = $derived(
    `${platform === "youtube" ? "YouTube" : platform[0]?.toUpperCase() + platform.slice(1)} ${model.format} player`,
  );

  function go(delta: number) {
    currentIndex = Math.min(Math.max(safeIndex + delta, 0), media.length - 1);
  }
</script>

<div
  class={[
    "vertical-preview",
    `platform-${platform}`,
    `format-${model.format}`,
    isStory && "is-story",
    compact && "compact",
  ]}
  aria-label={playerLabel}
>
  <div class="vertical-media">
    {#if activeMedia?.kind === "video"}
      <video
        src={activeMedia.src}
        poster={activeMedia.poster}
        aria-label={activeMedia.alt || "Video preview"}
        muted
        playsinline
        preload="metadata"
      ></video>
      <span class="center-play" aria-hidden="true"
        ><Play fill="currentColor" /></span
      >
    {:else if activeMedia}
      <img src={activeMedia.src} alt={activeMedia.alt || ""} />
    {:else}
      <div class="empty-frame">
        <Play aria-hidden="true" />
        <span
          >{model.format === "story"
            ? "Story"
            : model.format === "photo"
              ? "Photo"
              : "Video"} preview</span
        >
      </div>
    {/if}
  </div>

  <div class="top-fade" aria-hidden="true"></div>
  <div class="bottom-fade" aria-hidden="true"></div>

  {#if isStory}
    <div class="story-progress" aria-hidden="true">
      {#each media.length > 0 ? media : [{ id: "empty" }] as item, index (item.id)}
        <span class:active={index === safeIndex}></span>
      {/each}
    </div>
    <div class="story-heading">
      <PreviewAvatar
        identity={model.identity}
        size={34}
        ring={platform === "instagram"}
      />
      <strong>{handle}</strong>
      <span>{model.createdAtLabel}</span>
      <MoreHorizontal aria-hidden="true" />
      <X aria-hidden="true" />
    </div>
  {:else}
    <div class="player-heading">
      {#if platform === "facebook"}<strong>Reels</strong>{/if}
      {#if platform === "youtube"}<strong>Shorts</strong>{/if}
      <span class="volume"><Volume2 aria-hidden="true" /></span>
      <MoreHorizontal aria-hidden="true" />
    </div>
  {/if}

  {#if media.length > 1}
    <button
      type="button"
      class="media-nav previous"
      aria-label="Previous media"
      onclick={() => go(-1)}
      disabled={safeIndex === 0}
    >
      <ChevronLeft />
    </button>
    <button
      type="button"
      class="media-nav next"
      aria-label="Next media"
      onclick={() => go(1)}
      disabled={safeIndex === media.length - 1}
    >
      <ChevronRight />
    </button>
  {/if}

  {#if isStory}
    <div class="story-reply">
      <span>Send message…</span>
      <Heart aria-hidden="true" />
      <Send aria-hidden="true" />
    </div>
  {:else}
    <div class="vertical-copy">
      <div class="author-row">
        <strong>@{handle}</strong>
        {#if platform === "instagram" || platform === "youtube"}
          <span>{platform === "youtube" ? "Subscribe" : "Follow"}</span>
        {/if}
      </div>
      <p>{segment.text || model.title || "Your caption will appear here."}</p>
      <div class="audio-row">
        <Music2 aria-hidden="true" />
        <span
          >{platform === "youtube"
            ? "Original sound"
            : `Original audio · ${handle}`}</span
        >
      </div>
    </div>
    <div class="action-stack">
      <PreviewAvatar identity={model.identity} size={40} />
      <PreviewActions {platform} vertical />
      {#if platform === "tiktok"}
        <span class="music-disc"><Music2 aria-hidden="true" /></span>
      {/if}
    </div>
  {/if}

  <div class="player-progress" aria-hidden="true"><span></span></div>
</div>

<style>
  .vertical-preview {
    --player-width: 24rem;
    position: relative;
    width: min(100%, var(--player-width));
    overflow: hidden;
    aspect-ratio: 9 / 16;
    border-radius: 0.65rem;
    background: #111;
    color: white;
    font-family:
      -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial,
      sans-serif;
    isolation: isolate;
  }

  .vertical-media,
  .vertical-media img,
  .vertical-media video,
  .empty-frame {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .vertical-media img,
  .vertical-media video {
    display: block;
    object-fit: cover;
  }

  .empty-frame {
    display: grid;
    place-items: center;
    align-content: center;
    gap: 0.75rem;
    background:
      radial-gradient(
        circle at 50% 35%,
        rgb(255 255 255 / 9%),
        transparent 32%
      ),
      #181818;
    color: #d7d7d7;
  }

  .empty-frame :global(svg) {
    width: 3rem;
    height: 3rem;
    stroke-width: 1.4;
  }

  .empty-frame span {
    font-size: 0.82rem;
  }

  .center-play {
    position: absolute;
    z-index: 1;
    top: 50%;
    left: 50%;
    display: grid;
    width: 4rem;
    height: 4rem;
    translate: -50% -50%;
    place-items: center;
    border-radius: 50%;
    background: rgb(0 0 0 / 35%);
    color: white;
  }

  .center-play :global(svg) {
    width: 2rem;
    height: 2rem;
    margin-left: 0.2rem;
  }

  .top-fade,
  .bottom-fade {
    position: absolute;
    z-index: 1;
    right: 0;
    left: 0;
    pointer-events: none;
  }

  .top-fade {
    top: 0;
    height: 24%;
    background: linear-gradient(rgb(0 0 0 / 52%), transparent);
  }

  .bottom-fade {
    bottom: 0;
    height: 46%;
    background: linear-gradient(transparent, rgb(0 0 0 / 72%));
  }

  .story-progress {
    position: absolute;
    z-index: 2;
    top: 0.65rem;
    right: 0.65rem;
    left: 0.65rem;
    display: flex;
    gap: 0.2rem;
  }

  .story-progress span {
    height: 2px;
    flex: 1;
    border-radius: 999px;
    background: rgb(255 255 255 / 38%);
  }

  .story-progress span.active {
    background: white;
  }

  .story-heading {
    position: absolute;
    z-index: 2;
    top: 1.2rem;
    right: 0.75rem;
    left: 0.75rem;
    display: flex;
    align-items: center;
    gap: 0.55rem;
    font-size: 0.78rem;
    filter: drop-shadow(0 1px 1px rgb(0 0 0 / 50%));
  }

  .story-heading > span {
    color: rgb(255 255 255 / 75%);
  }

  .story-heading > :global(svg):first-of-type {
    margin-left: auto;
  }

  .story-heading > :global(svg) {
    width: 1.35rem;
    height: 1.35rem;
  }

  .player-heading {
    position: absolute;
    z-index: 2;
    top: 0.9rem;
    right: 0.85rem;
    left: 0.85rem;
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .player-heading strong {
    font-size: 1.05rem;
  }

  .player-heading .volume {
    margin-left: auto;
  }

  .player-heading .volume :global(svg) {
    width: 1.3rem;
    height: 1.3rem;
  }

  .player-heading :global(svg) {
    width: 1.3rem;
    height: 1.3rem;
  }

  .media-nav {
    position: absolute;
    z-index: 3;
    top: 50%;
    display: grid;
    width: 2.75rem;
    height: 2.75rem;
    translate: 0 -50%;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: rgb(0 0 0 / 40%);
    color: white;
    cursor: pointer;
  }

  .media-nav.previous {
    left: 0.4rem;
  }

  .media-nav.next {
    right: 0.4rem;
  }

  .media-nav:disabled {
    opacity: 0;
    pointer-events: none;
  }

  .media-nav:focus-visible {
    outline: 2px solid white;
    outline-offset: 2px;
  }

  .story-reply {
    position: absolute;
    z-index: 2;
    right: 0.85rem;
    bottom: 1.15rem;
    left: 0.85rem;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 0.8rem;
  }

  .story-reply > span {
    min-height: 2.75rem;
    display: flex;
    align-items: center;
    border: 1px solid rgb(255 255 255 / 80%);
    border-radius: 999px;
    padding: 0 1rem;
    font-size: 0.8rem;
  }

  .story-reply :global(svg) {
    width: 1.55rem;
    height: 1.55rem;
  }

  .vertical-copy {
    position: absolute;
    z-index: 2;
    right: 4.25rem;
    bottom: 1.3rem;
    left: 0.85rem;
    display: grid;
    gap: 0.45rem;
    filter: drop-shadow(0 1px 1px rgb(0 0 0 / 55%));
  }

  .author-row {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    font-size: 0.85rem;
  }

  .author-row > span {
    border: 1px solid rgb(255 255 255 / 75%);
    border-radius: 0.45rem;
    padding: 0.25rem 0.55rem;
    font-size: 0.7rem;
    font-weight: 700;
  }

  .vertical-copy p {
    display: -webkit-box;
    overflow: hidden;
    margin: 0;
    font-size: 0.8rem;
    line-height: 1.4;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
  }

  .audio-row {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.7rem;
  }

  .audio-row :global(svg) {
    width: 0.85rem;
    height: 0.85rem;
  }

  .audio-row span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .action-stack {
    position: absolute;
    z-index: 2;
    right: 0.5rem;
    bottom: 1.25rem;
    display: grid;
    justify-items: center;
    gap: 0.65rem;
  }

  .music-disc {
    display: grid;
    width: 2.6rem;
    height: 2.6rem;
    place-items: center;
    border: 0.55rem solid #2f2f2f;
    border-radius: 50%;
    background: #111;
  }

  .music-disc :global(svg) {
    width: 0.85rem;
    height: 0.85rem;
  }

  .player-progress {
    position: absolute;
    z-index: 3;
    right: 0;
    bottom: 0;
    left: 0;
    height: 2px;
    background: rgb(255 255 255 / 25%);
  }

  .player-progress span {
    display: block;
    width: 31%;
    height: 100%;
    background: white;
  }

  .platform-youtube {
    --player-width: 23rem;
    border-radius: 0.75rem;
    font-family: Roboto, Arial, sans-serif;
  }

  .platform-youtube .vertical-copy {
    bottom: 1.6rem;
  }

  .platform-tiktok {
    --player-width: 23.5rem;
    border-radius: 0.35rem;
    font-family: TikTokFont, Arial, sans-serif;
  }

  .platform-facebook {
    border-radius: 0.75rem;
    font-family: Arial, Helvetica, sans-serif;
  }

  .compact {
    --player-width: 20rem;
  }

  @media (max-width: 32rem) {
    .vertical-preview {
      width: min(100%, 22rem);
      border-radius: 0.45rem;
    }
  }
</style>
