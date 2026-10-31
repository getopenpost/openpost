<script lang="ts">
  import { previewEditing } from "./editing";
  import Globe2 from "@lucide/svelte/icons/globe-2";
  import MoreHorizontal from "@lucide/svelte/icons/ellipsis";
  import X from "@lucide/svelte/icons/x";
  import type { PreviewModel } from "./model";
  import PreviewActions from "./PreviewActions.svelte";
  import PreviewAttachment from "./PreviewAttachment.svelte";
  import PreviewAvatar from "./PreviewAvatar.svelte";
  import PreviewMedia from "./PreviewMedia.svelte";
  import VerticalPreview from "./VerticalPreview.svelte";
  import PreviewText from "./PreviewText.svelte";

  const editing = previewEditing();

  interface Props {
    model: PreviewModel;
    compact?: boolean;
  }

  let { model, compact = false }: Props = $props();
  const primary = $derived(model.segments[0] ?? { id: "primary", text: "" });
  const media = $derived(primary.media ?? model.media);
  const text = $derived(
    model.format === "video" ? model.subtitle || primary.text : primary.text,
  );
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

    {#if editing()?.text}<div class="post-text">{@render editing()!.text(primary)}</div>{:else if text}<div class="post-text"><PreviewText {text} lines={5} /></div>{/if}
    {#if model.card}<PreviewAttachment segment={primary}
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
    --native-surface: light-dark(#fff, #242526);
    --native-fg: light-dark(#050505, #e4e6eb);
    --native-muted: light-dark(#65676b, #b0b3b8);
    --native-border: light-dark(#ced0d4, #3e4042);
    --native-soft: light-dark(#e4e6eb, #3a3b3c);
    width: min(100%, 41.25rem);
    overflow: hidden;
    border-radius: 0.5rem;
    background: var(--native-surface);
    color: var(--native-fg);
    box-shadow: 0 1px 2px rgb(0 0 0 / 20%);
    font-family:
      system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI Historic", "Segoe UI",
      Helvetica, Arial, sans-serif;
  }

  header {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem 0.45rem;
  }

  .identity {
    display: grid;
    min-width: 0;
    gap: 0.12rem;
  }

  .identity strong {
    overflow: hidden;
    font-size: 0.9375rem;
    font-weight: 600;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .identity span {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    color: var(--native-muted);
    font-size: 0.8125rem;
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
    font-size: 0.9375rem;
    line-height: 1.3333;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .engagement {
    display: flex;
    min-height: 2.5rem;
    align-items: center;
    gap: 0.6rem;
    padding-block: 0.5rem;
    margin-inline: 1rem;
    border-bottom: 1px solid var(--native-border);
    color: var(--native-muted);
    font-size: 0.9375rem;
  }

  .reactions {
    display: flex;
  }

  .reactions i {
    display: grid;
    width: 1.25rem;
    height: 1.25rem;
    place-items: center;
    margin-right: -0.25rem;
    border: 2px solid var(--native-surface);
    border-radius: 50%;
    background: #0866ff;
    color: white;
    font-size: 0.625rem;
    font-style: normal;
  }

  .reactions i:last-child {
    background: #f3425f;
  }

  .engagement .right {
    margin-left: auto;
  }

  .action-row {
    padding: 0.25rem 1rem;
  }

  .action-row :global(.action) {
    min-height: 2.25rem;
    gap: 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.9375rem;
  }

  .action-row :global(.action:hover) {
    background: var(--native-soft);
  }

  .action-row :global(.icon svg) {
    width: 1.25rem;
    height: 1.25rem;
  }

  .compact header,
  .compact .post-text {
    padding-inline: 0.75rem;
  }
</style>
