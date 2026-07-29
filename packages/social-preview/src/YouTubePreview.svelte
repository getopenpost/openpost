<script lang="ts">
  import Bell from "@lucide/svelte/icons/bell";
  import MoreHorizontal from "@lucide/svelte/icons/ellipsis";
  import type { PreviewModel } from "./model";
  import PlatformGlyph from "./PlatformGlyph.svelte";
  import PreviewActions from "./PreviewActions.svelte";
  import PreviewAvatar from "./PreviewAvatar.svelte";
  import PreviewMedia from "./PreviewMedia.svelte";
  import VerticalPreview from "./VerticalPreview.svelte";

  interface Props {
    model: PreviewModel;
    compact?: boolean;
  }

  let { model, compact = false }: Props = $props();
  const primary = $derived(model.segments[0] ?? { id: "primary", text: "" });
  const media = $derived(primary.media?.length ? primary.media : model.media);
  const title = $derived(model.title || primary.text || "Your video title");
  const description = $derived(
    model.subtitle ||
      primary.text ||
      "Your video description will appear here.",
  );
</script>

{#if model.format === "short"}
  <VerticalPreview {model} platform="youtube" {compact} />
{:else}
  <article class={["youtube-preview", compact && "compact"]}>
    <div class="player">
      {#if media.length > 0}
        <PreviewMedia media={media.slice(0, 1)} layout="single" />
      {:else}
        <div class="empty-player">
          <PlatformGlyph platform="youtube" />
          <span>Video preview</span>
        </div>
      {/if}
      <div class="player-controls" aria-hidden="true">
        <span class="play-button">▶</span>
        <span>0:00 / 0:00</span>
        <i></i>
        <span>⚙</span>
        <span>□</span>
      </div>
    </div>

    <h2>{title}</h2>
    <div class="video-meta">
      <div class="channel">
        <PreviewAvatar identity={model.identity} size={40} />
        <div>
          <strong>{model.identity.displayName}</strong>
          <span>@{model.identity.handle.replace(/^@/u, "")}</span>
        </div>
        <button type="button" tabindex="-1">Subscribe</button>
        <Bell aria-hidden="true" />
      </div>
      <div class="video-actions">
        <PreviewActions platform="youtube" {compact} />
      </div>
    </div>

    <div class="description">
      <strong>0 views · {model.createdAtLabel}</strong>
      <p>{description}</p>
    </div>

    <div class="comments">
      <div>
        <strong>Comments</strong>
        <span>0</span>
      </div>
      <MoreHorizontal aria-hidden="true" />
    </div>
  </article>
{/if}

<style>
  .youtube-preview {
    --native-bg: #fff;
    --native-surface: #fff;
    --native-fg: #0f0f0f;
    --native-muted: #606060;
    --native-border: #e5e5e5;
    --native-soft: #f2f2f2;
    width: min(100%, 51rem);
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
    width: 18%;
    height: 100%;
    background: #f00;
  }

  h2 {
    margin: 0.75rem 0 0.5rem;
    font-size: 1.24rem;
    font-weight: 600;
    line-height: 1.35;
    letter-spacing: -0.015em;
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

  .channel button {
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

  .compact h2 {
    font-size: 1.05rem;
  }

  @media (prefers-color-scheme: dark) {
    .youtube-preview {
      --native-bg: #0f0f0f;
      --native-surface: #0f0f0f;
      --native-fg: #f1f1f1;
      --native-muted: #aaa;
      --native-border: #303030;
      --native-soft: #272727;
    }
  }

  :global(.dark) .youtube-preview {
    --native-bg: #0f0f0f;
    --native-surface: #0f0f0f;
    --native-fg: #f1f1f1;
    --native-muted: #aaa;
    --native-border: #303030;
    --native-soft: #272727;
  }

  @media (max-width: 43rem) {
    .player {
      border-radius: 0;
    }

    h2,
    .video-meta,
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
  }
</style>
