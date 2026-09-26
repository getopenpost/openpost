<script lang="ts">
  import type { PreviewModel, PreviewPlatform } from "./model";
  import PreviewActions from "./PreviewActions.svelte";
  import PreviewAttachment from "./PreviewAttachment.svelte";
  import PreviewAvatar from "./PreviewAvatar.svelte";
  import PreviewMedia from "./PreviewMedia.svelte";

  interface Props {
    model: PreviewModel;
    platform: Extract<PreviewPlatform, "lemmy" | "piefed" | "reddit">;
    compact?: boolean;
  }

  let { model, platform, compact = false }: Props = $props();
  const primary = $derived(model.segments[0] ?? { id: "primary", text: "" });
  const media = $derived(primary.media ?? model.media);
  const title = $derived(model.title || primary.text || "Untitled post");
  const body = $derived(model.title ? primary.text : "");
</script>

<article
  class={["community-preview", `platform-${platform}`, compact && "compact"]}
>
  <header>
    <PreviewAvatar identity={model.identity} size={40} />
    <div class="community-meta">
      {#if model.subtitle}
        <strong class="community-name">{model.subtitle}</strong>
      {/if}
      <span class="author-line">
        {model.identity.displayName} · {model.createdAtLabel}
      </span>
    </div>
  </header>

  <h2>{title}</h2>
  {#if body}
    <p class="post-body">{body}</p>
  {/if}
  {#if model.card}
    <PreviewAttachment card={model.card} {platform} />
  {/if}
  {#if media.length > 0}
    <PreviewMedia
      {media}
      layout={platform === "reddit" && media.length > 1 ? "carousel" : "single"}
    />
  {/if}

  <PreviewActions {platform} {compact} />
</article>

<style>
  .community-preview {
    --native-bg: light-dark(#fff, #0b1416);
    --native-surface: light-dark(#f6f7f8, #1a282d);
    --native-fg: light-dark(#1a1a1b, #eef1f3);
    --native-muted: light-dark(#596469, #a8b5bc);
    --native-border: light-dark(#e5e5e6, #34464d);
    width: min(100%, 40rem);
    overflow: hidden;
    border: 1px solid var(--native-border);
    border-radius: 0.5rem;
    background: var(--native-bg);
    color: var(--native-fg);
    font-family:
      -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial,
      sans-serif;
  }

  .community-preview header {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.75rem 1rem 0;
  }

  .community-meta {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }

  .community-name {
    overflow: hidden;
    font-size: 0.8rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .author-line {
    color: var(--native-muted);
    font-size: 0.75rem;
  }

  .community-preview h2 {
    margin: 0;
    padding: 0.6rem 1rem 0;
    overflow-wrap: anywhere;
    font-size: 1.05rem;
    line-height: 1.35;
  }

  .post-body {
    margin: 0;
    padding: 0.5rem 1rem 0;
    font-size: 0.9rem;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .community-preview :global(.preview-actions) {
    border-top: 1px solid var(--native-border);
    margin-top: 0.75rem;
  }
  .platform-reddit {
    border: 0;
    border-radius: 1rem;
    padding: 0.25rem;
  }
  .platform-reddit h2 {
    font-size: 1.15rem;
    font-weight: 650;
  }
  .platform-reddit :global(.preview-actions) {
    justify-content: flex-start;
    gap: 1rem;
    padding-inline: 0.75rem;
    border-top: 0;
  }
  .platform-reddit :global(.media-carousel),
  .platform-reddit :global(.single-media) {
    margin-top: 0.75rem;
    border-radius: 1rem;
  }
  .platform-lemmy {
    border-radius: 0.3rem;
  }
  .platform-piefed {
    --native-bg: light-dark(#fff, #212529);
    --native-fg: light-dark(#212529, #dee2e6);
    border-radius: 0.4rem;
  }
  .compact header,
  .compact h2,
  .compact .post-body {
    padding-inline: 0.75rem;
  }
</style>
