<script lang="ts">
  import { previewEditing } from "./editing";
  import Play from "@lucide/svelte/icons/play";
  import Settings from "@lucide/svelte/icons/settings";
  import Maximize from "@lucide/svelte/icons/maximize";
  import Bell from "@lucide/svelte/icons/bell";
  import MoreHorizontal from "@lucide/svelte/icons/ellipsis";
  import type { PreviewModel } from "./model";
  import PlatformGlyph from "./PlatformGlyph.svelte";
  import PreviewActions from "./PreviewActions.svelte";
  import PreviewAvatar from "./PreviewAvatar.svelte";
  import PreviewMedia from "./PreviewMedia.svelte";
  import VerticalPreview from "./VerticalPreview.svelte";

  const editing = previewEditing();

  interface Props {
    model: PreviewModel;
    platform?: "youtube" | "peertube";
    compact?: boolean;
  }

  let { model, platform = "youtube", compact = false }: Props = $props();
  const primary = $derived(model.segments[0] ?? { id: "primary", text: "" });
  const media = $derived(primary.media ?? model.media);
  const title = $derived(model.title || primary.text || "Your video title");
  const description = $derived(
    model.subtitle ||
      primary.text ||
      "Your video description will appear here.",
  );
</script>

{#if model.format === "short"}
  <VerticalPreview {model} {platform} {compact} />
{:else}
  <article
    class={["youtube-preview", `platform-${platform}`, compact && "compact"]}
  >
    <div class="player">
      {#if media.length > 0}
        <PreviewMedia media={media.slice(0, 1)} layout="single" />
      {:else}
        <div class="empty-player">
          <PlatformGlyph {platform} />
          <span>Video preview</span>
        </div>
      {/if}
      <div class="player-controls" aria-hidden="true">
        <span class="play-button"><Play fill="currentColor" /></span>
        <span
          >0:00{media[0]?.durationLabel
            ? ` / ${media[0].durationLabel}`
            : ""}</span
        >
        <i></i>
        <Settings /><Maximize />
      </div>
    </div>

    <h2 dir="auto">{#if editing()?.title}{@render editing()!.title!(title, primary)}{:else}{title}{/if}</h2>
    {#if platform === "peertube"}
      <div class="watch-info">
        <span class="watch-stats">{model.createdAtLabel} • 0 views</span>
        <div class="video-actions">
          <PreviewActions {platform} {compact} />
        </div>
      </div>
      <div class="watch-channel">
        <PreviewAvatar identity={model.identity} size={35} />
        <div>
          <strong>{model.identity.displayName}</strong>
          <span>By {model.identity.handle.replace(/^@/u, "")}</span>
        </div>
        <span class="subscribe">Subscribe</span>
      </div>
    {:else}
      <div class="video-meta">
        <div class="channel">
          <PreviewAvatar identity={model.identity} size={40} />
          <div>
            <strong>{model.identity.displayName}</strong>
            <span>@{model.identity.handle.replace(/^@/u, "")}</span>
          </div>
          <span class="subscribe">Subscribe</span>
          <Bell aria-hidden="true" />
        </div>
        <div class="video-actions">
          <PreviewActions {platform} {compact} />
        </div>
      </div>
    {/if}

    <div class="description">
      {#if platform !== "peertube"}<strong>0 views · {model.createdAtLabel}</strong>{/if}
      {#if editing()?.text}{@render editing()!.text(primary)}{:else}<p dir="auto">{description}</p>{/if}
    </div>

    <div class="comments">
      <div>
        <strong>Comments</strong>
        {#if platform === "peertube"}
          <p class="no-comments">No comments.</p>
        {:else}
          <span>0</span>
        {/if}
      </div>
      {#if platform !== "peertube"}<MoreHorizontal aria-hidden="true" />{/if}
    </div>
  </article>
{/if}

<style>
  .youtube-preview {
    --native-bg: light-dark(#fff, #0f0f0f);
    --native-surface: light-dark(#fff, #0f0f0f);
    --native-fg: light-dark(#0f0f0f, #f1f1f1);
    --native-muted: light-dark(#606060, #aaa);
    --native-border: light-dark(#e5e5e5, #303030);
    --native-soft: light-dark(#f2f2f2, #272727);
    width: min(100%, 51rem);
    background: var(--native-bg);
    color: var(--native-fg);
    font-family: Roboto, Arial, sans-serif;
  }

  .player {
    position: relative;
    overflow: hidden;
    aspect-ratio: 16 / 9;
    border-radius: 0.75rem;
    background: #000;
  }

  .player :global(.single-media),
  .player :global(.media-tile) {
    height: 100%;
    max-height: none;
    aspect-ratio: auto;
  }

  .empty-player {
    display: grid;
    height: 100%;
    place-items: center;
    align-content: center;
    gap: 0.8rem;
    background: radial-gradient(circle at center, #242424, #050505 68%);
    color: #fff;
  }

  .empty-player :global(svg) {
    width: 4.25rem;
    height: 4.25rem;
    color: #ff0033;
  }

  .empty-player span {
    font-size: 0.82rem;
  }

  .player-controls {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 0.75rem;
    padding: 2.5rem 0.85rem 0.6rem;
    background: linear-gradient(transparent, rgb(0 0 0 / 78%));
    color: #fff;
    font-size: 0.72rem;
  }

  .play-button {
    font-size: 1rem;
  }

  .player-controls i {
    position: absolute;
    right: 0.75rem;
    bottom: 0.25rem;
    left: 0.75rem;
    height: 3px;
    background: rgb(255 255 255 / 30%);
  }

  .player-controls i::before {
    content: "";
    display: block;
    width: 0;
    height: 100%;
    background: #f00;
  }

  h2 {
    margin: 0.75rem 0 0.5rem;
    font-size: 1.24rem;
    font-weight: 600;
    line-height: 1.35;
    letter-spacing: -0.015em;
    overflow-wrap: anywhere;
  }

  .video-meta {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 1rem;
  }

  .channel {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.65rem;
  }

  .channel > div {
    display: grid;
    min-width: 0;
  }

  .channel strong {
    overflow: hidden;
    font-size: 0.88rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .channel span {
    color: var(--native-muted);
    font-size: 0.72rem;
  }

  .channel .subscribe {
    display: inline-flex;
    align-items: center;
    min-height: 2.25rem;
    border: 0;
    border-radius: 999px;
    background: var(--native-fg);
    color: var(--native-bg);
    padding: 0 1rem;
    font: inherit;
    font-size: 0.8rem;
    font-weight: 600;
    pointer-events: none;
  }

  .channel > :global(svg) {
    width: 1.15rem;
    height: 1.15rem;
  }

  .video-actions {
    min-width: 0;
    flex: 1;
    overflow: hidden;
  }

  .description {
    display: grid;
    gap: 0.25rem;
    margin-top: 0.85rem;
    border-radius: 0.75rem;
    background: var(--native-soft);
    padding: 0.75rem;
  }

  .description strong {
    font-size: 0.76rem;
  }

  .description p {
    display: -webkit-box;
    overflow: hidden;
    margin: 0;
    font-size: 0.78rem;
    line-height: 1.45;
    white-space: pre-wrap;
    unicode-bidi: plaintext;
    text-align: start;
    overflow-wrap: anywhere;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
  }

  .comments {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 1rem;
    padding-block: 0.75rem;
    border-top: 1px solid var(--native-border);
  }

  .comments > div {
    display: flex;
    gap: 0.5rem;
    font-size: 0.85rem;
  }

  .comments :global(svg) {
    width: 1.1rem;
    height: 1.1rem;
  }

  .player-controls :global(svg) {
    width: 1.15rem;
    height: 1.15rem;
  }
  .player :global(video),
  .player :global(img) {
    object-fit: contain;
  }
  .platform-peertube {
    --native-bg: light-dark(#f4f4f5, #121212);
    --native-surface: light-dark(#f4f4f5, #121212);
    --native-fg: light-dark(#0a0a0a, #f4f4f5);
    --native-muted: light-dark(#8d7777, #8d7777);
    --native-border: light-dark(#e8dede, #2f2323);
    --native-soft: light-dark(#e8dede, #2f2323);
    font-family: "Source Sans Pro", sans-serif;
  }
  .platform-peertube .player {
    border-radius: 5px;
  }
  .platform-peertube .empty-player :global(svg) {
    color: #ff8e38;
  }
  .platform-peertube h2 {
    margin-top: 1.5rem;
    min-height: 40px;
    font-size: 27px;
    line-height: 1.2;
    letter-spacing: normal;
  }
  .platform-peertube .watch-info {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  .platform-peertube .watch-stats {
    color: var(--native-fg);
    font-size: 0.875rem;
  }
  .platform-peertube .video-actions :global(.preview-actions) {
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0;
    color: light-dark(#3d2f2f, #d5c8c8);
    font-weight: 700;
  }
  .platform-peertube .video-actions :global(.preview-actions .action) {
    flex: 0 0 auto;
    gap: 8px;
    padding: 4px 13px;
    font-size: 1rem;
    text-transform: uppercase;
  }
  .platform-peertube .video-actions :global(.preview-actions .icon) {
    width: auto;
    height: auto;
    background: none;
  }
  .platform-peertube .video-actions :global(.preview-actions .icon svg) {
    width: 21px;
    height: 21px;
  }
  .platform-peertube .watch-channel {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    margin-top: 0;
    border-top: 1px solid var(--native-border);
    padding-top: 1rem;
  }
  .platform-peertube .watch-channel > div {
    display: grid;
    min-width: 0;
    gap: 0;
    line-height: 1.37;
  }
  .platform-peertube .watch-channel strong {
    overflow: hidden;
    font-size: 1rem;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .platform-peertube .watch-channel > div > span {
    color: var(--native-fg);
    font-size: 0.9rem;
    font-weight: 400;
  }
  .platform-peertube .watch-channel .subscribe {
    margin-left: auto;
    min-height: 2.3rem;
    border-radius: 4px;
    background: #ff8e38;
    color: light-dark(#0a0a0a, #111);
    padding: 0.3rem 0.65rem;
    font-size: 1rem;
    font-weight: 700;
  }
  .platform-peertube .description {
    margin: 1.25rem 0;
    margin-inline-start: 2.75rem;
    border-radius: 0;
    background: none;
    padding: 0;
  }
  .platform-peertube .description p {
    font-size: 1rem;
    line-height: 1.5;
  }
  .platform-peertube .comments {
    margin-top: 0;
    padding-block: 1rem;
  }
  .platform-peertube .comments strong {
    font-size: 1.25rem;
    font-weight: 500;
  }
  .platform-peertube .no-comments {
    margin: 1.5rem 0 0;
    color: var(--native-fg);
    font-size: 1rem;
    font-weight: 400;
  }
  .compact h2 {
    font-size: 1.05rem;
  }
  .platform-peertube.compact h2 {
    min-height: 0;
  }
  @container (max-width: 43rem) {
    .player {
      border-radius: 0;
    }
    h2,
    .video-meta,
    .watch-info,
    .watch-channel,
    .description,
    .comments {
      margin-inline: 0.75rem;
    }
    .video-meta {
      align-items: flex-start;
      flex-direction: column;
    }
    .video-actions {
      width: 100%;
    }
    .platform-peertube:not(.compact) h2 {
      font-size: 20px;
    }
    .platform-peertube .video-actions :global(.preview-actions .action) {
      padding: 4px 8px;
      font-size: 0.85rem;
    }
  }
</style>
