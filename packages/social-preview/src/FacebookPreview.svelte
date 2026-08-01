<script lang="ts">
  import Globe2 from "@lucide/svelte/icons/globe-2";
  import MoreHorizontal from "@lucide/svelte/icons/ellipsis";
  import X from "@lucide/svelte/icons/x";
  import type { PreviewModel } from "./model";
  import PreviewActions from "./PreviewActions.svelte";
  import PreviewAttachment from "./PreviewAttachment.svelte";
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
  const isVertical = $derived(
    model.format === "story" || model.format === "reel",
  );
</script>

{#if isVertical}
  <VerticalPreview {model} platform="facebook" {compact} />
{:else}
  <article class={["facebook-preview", compact && "compact"]}>
    <header>
      <PreviewAvatar identity={model.identity} size={40} />
      <div class="identity">
        <strong>{model.identity.displayName}</strong>
        <span>{model.createdAtLabel} · <Globe2 aria-label="Public" /></span>
      </div>
      <div class="header-actions">
        <MoreHorizontal aria-hidden="true" />
        <X aria-hidden="true" />
      </div>
    </header>

    {#if primary.text}
      <p class="post-text">{primary.text}</p>
    {/if}
    {#if model.card}<PreviewAttachment
        card={model.card}
        platform="facebook"
      />{/if}
    {#if media.length > 0}
      <PreviewMedia {media} layout="facebook" />
    {:else if model.format === "video"}
      <PreviewMedia media={[]} layout="single" emptyLabel="Video preview" />
    {/if}

    <div class="engagement">
      <span class="reactions" aria-hidden="true"><i>👍</i><i>♥</i></span>
      <span>0</span>
      <span class="right">0 comments · 0 shares</span>
    </div>
    <div class="action-row">
      <PreviewActions platform="facebook" {compact} />
    </div>
  </article>
{/if}

<style>
  .facebook-preview {
    --native-bg: #f0f2f5;
    --native-surface: #fff;
    --native-fg: #050505;
    --native-muted: #65676b;
    --native-border: #ced0d4;
    --native-soft: #e4e6eb;
    width: min(100%, 31.25rem);
    overflow: hidden;
    border: 1px solid #dddfe2;
    border-radius: 0.5rem;
    background: var(--native-surface);
    color: var(--native-fg);
    box-shadow: 0 1px 2px rgb(0 0 0 / 14%);
    font-family: Arial, Helvetica, sans-serif;
  }

  header {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.6rem;
    padding: 0.75rem 1rem 0.45rem;
  }

  .identity {
    display: grid;
    min-width: 0;
    gap: 0.12rem;
  }

  .identity strong {
    overflow: hidden;
    font-size: 0.88rem;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .identity span {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    color: var(--native-muted);
    font-size: 0.72rem;
  }

  .identity span :global(svg) {
    width: 0.75rem;
    height: 0.75rem;
  }

  .header-actions {
    display: flex;
    gap: 0.65rem;
    color: var(--native-muted);
  }

  .header-actions :global(svg) {
    width: 1.25rem;
    height: 1.25rem;
  }

  .post-text {
    margin: 0;
    padding: 0.35rem 1rem 0.75rem;
    font-size: 0.94rem;
    line-height: 1.35;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .engagement {
    display: flex;
    min-height: 2.7rem;
    align-items: center;
    gap: 0.35rem;
    margin-inline: 1rem;
    border-bottom: 1px solid var(--native-border);
    color: var(--native-muted);
    font-size: 0.78rem;
  }

  .reactions {
    display: flex;
  }

  .reactions i {
    display: grid;
    width: 1.15rem;
    height: 1.15rem;
    place-items: center;
    margin-right: -0.15rem;
    border: 2px solid var(--native-surface);
    border-radius: 50%;
    background: #1877f2;
    color: white;
    font-size: 0.65rem;
    font-style: normal;
  }

  .reactions i:last-child {
    background: #f55368;
  }

  .engagement .right {
    margin-left: auto;
  }

  .action-row {
    padding: 0.15rem 0.55rem;
  }

  .compact header,
  .compact .post-text {
    padding-inline: 0.75rem;
  }

  @media (prefers-color-scheme: dark) {
    .facebook-preview {
      --native-bg: #18191a;
      --native-surface: #242526;
      --native-fg: #e4e6eb;
      --native-muted: #b0b3b8;
      --native-border: #3e4042;
      --native-soft: #3a3b3c;
      border-color: #3e4042;
    }
  }

  :global(.dark) .facebook-preview {
    --native-bg: #18191a;
    --native-surface: #242526;
    --native-fg: #e4e6eb;
    --native-muted: #b0b3b8;
    --native-border: #3e4042;
    --native-soft: #3a3b3c;
    border-color: #3e4042;
  }

  @media (max-width: 32rem) {
    .facebook-preview {
      border-inline: 0;
      border-radius: 0;
    }
  }
</style>
