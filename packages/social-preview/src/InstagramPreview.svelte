<script lang="ts">
  import MoreHorizontal from "@lucide/svelte/icons/ellipsis";
  import type { PreviewModel } from "./model";
  import PreviewActions from "./PreviewActions.svelte";
  import PreviewAvatar from "./PreviewAvatar.svelte";
  import PreviewMedia from "./PreviewMedia.svelte";
  import VerifiedBadge from "./VerifiedBadge.svelte";
  import VerticalPreview from "./VerticalPreview.svelte";

  interface Props {
    model: PreviewModel;
    compact?: boolean;
  }

  let { model, compact = false }: Props = $props();
  const primary = $derived(model.segments[0] ?? { id: "primary", text: "" });
  const media = $derived(primary.media?.length ? primary.media : model.media);
  const handle = $derived(model.identity.handle.replace(/^@/u, ""));
  const isVertical = $derived(
    model.format === "story" || model.format === "reel",
  );
</script>

{#if isVertical}
  <VerticalPreview {model} platform="instagram" {compact} />
{:else}
  <article class={["instagram-preview", compact && "compact"]}>
    <header>
      <span class="story-ring">
        <PreviewAvatar identity={model.identity} size={32} />
      </span>
      <div class="identity">
        <div>
          <strong>{handle}</strong>
          {#if model.identity.verified}<VerifiedBadge
              platform="instagram"
            />{/if}
        </div>
        {#if model.location}<span>{model.location}</span>{/if}
      </div>
      <MoreHorizontal aria-hidden="true" />
    </header>

    {#if media.length > 0}
      <PreviewMedia {media} layout="carousel" />
    {:else}
      <div class="empty-feed-media">
        <span aria-hidden="true">▧</span>
        <p>Add a photo or video to preview an Instagram post.</p>
      </div>
    {/if}

    <div class="post-actions">
      <PreviewActions platform="instagram" {compact} />
    </div>
    <div class="caption">
      <p>
        <strong>{handle}</strong>
        <span>{primary.text || "Your caption will appear here."}</span>
      </p>
      <span>View all 0 comments</span>
      <small>{model.createdAtLabel}</small>
    </div>
  </article>
{/if}

<style>
  .instagram-preview {
    --native-bg: #fff;
    --native-surface: #fff;
    --native-fg: #000;
    --native-muted: #737373;
    --native-border: #dbdbdb;
    width: min(100%, 29.25rem);
    overflow: hidden;
    border: 1px solid var(--native-border);
    border-radius: 0.5rem;
    background: var(--native-bg);
    color: var(--native-fg);
    font-family:
      -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial,
      sans-serif;
  }

  header {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.65rem;
    min-height: 3.75rem;
    padding: 0.55rem 0.85rem;
  }

  .story-ring {
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: conic-gradient(#d300c5, #ff3040, #ffdc80, #d300c5);
    padding: 2px;
  }

  .story-ring :global(.preview-avatar) {
    box-shadow: 0 0 0 2px var(--native-bg);
  }

  .identity {
    display: grid;
    min-width: 0;
    gap: 0.12rem;
  }

  .identity > div {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.25rem;
  }

  .identity strong {
    overflow: hidden;
    font-size: 0.82rem;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .identity > span {
    font-size: 0.68rem;
  }

  header > :global(svg) {
    width: 1.25rem;
    height: 1.25rem;
  }

  .empty-feed-media {
    display: grid;
    aspect-ratio: 1;
    place-items: center;
    align-content: center;
    gap: 0.6rem;
    border-block: 1px solid var(--native-border);
    background: #f7f7f7;
    color: var(--native-muted);
    text-align: center;
  }

  .empty-feed-media > span {
    font-size: 2.4rem;
    font-weight: 200;
  }

  .empty-feed-media p {
    max-width: 27ch;
    margin: 0;
    font-size: 0.75rem;
    line-height: 1.4;
  }

  .post-actions {
    padding: 0.15rem 0.55rem 0;
  }

  .post-actions :global(.preview-actions) {
    justify-content: flex-start;
    gap: 0.1rem;
  }

  .post-actions :global(.action:last-child) {
    margin-left: auto;
  }

  .caption {
    display: grid;
    gap: 0.3rem;
    padding: 0 0.85rem 0.85rem;
  }

  .caption p {
    margin: 0;
    font-size: 0.81rem;
    line-height: 1.45;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .caption p strong {
    margin-right: 0.35rem;
  }

  .caption > span {
    color: var(--native-muted);
    font-size: 0.78rem;
  }

  .caption small {
    margin-top: 0.2rem;
    color: var(--native-muted);
    font-size: 0.62rem;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }

  .compact header {
    min-height: 3.35rem;
  }

  @media (prefers-color-scheme: dark) {
    .instagram-preview {
      --native-bg: #000;
      --native-surface: #000;
      --native-fg: #f5f5f5;
      --native-muted: #a8a8a8;
      --native-border: #262626;
    }

    .empty-feed-media {
      background: #121212;
    }
  }

  :global(.dark) .instagram-preview {
    --native-bg: #000;
    --native-surface: #000;
    --native-fg: #f5f5f5;
    --native-muted: #a8a8a8;
    --native-border: #262626;
  }

  :global(.dark) .empty-feed-media {
    background: #121212;
  }

  @media (max-width: 32rem) {
    .instagram-preview {
      border-inline: 0;
      border-radius: 0;
    }
  }
</style>
