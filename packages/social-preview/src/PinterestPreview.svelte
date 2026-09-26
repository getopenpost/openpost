<script lang="ts">
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import Upload from "@lucide/svelte/icons/upload";
  import type { PreviewModel } from "./model";
  import PreviewAvatar from "./PreviewAvatar.svelte";
  import PreviewMedia from "./PreviewMedia.svelte";

  let { model, compact = false }: { model: PreviewModel; compact?: boolean } =
    $props();
  const primary = $derived(model.segments[0]);
  const media = $derived(primary?.media ?? model.media);
</script>

<article class={["pinterest-preview", compact && "compact"]}>
  <div class="pin-image">
    <PreviewMedia {media} layout="single" emptyLabel="Pin image preview" />
  </div>
  <div class="pin-details">
    <div class="pin-toolbar" aria-label="Pin actions">
      <Upload aria-label="Share" /><Ellipsis aria-label="More" />
      <span class="save">Save</span>
    </div>
    {#if model.card?.domain}<span class="domain">{model.card.domain}</span>{/if}
    {#if model.title}<h2>{model.title}</h2>{/if}
    {#if primary?.text}<p>{primary.text}</p>{/if}
    <div class="author">
      <PreviewAvatar identity={model.identity} size={32} /><strong
        >{model.identity.displayName}</strong
      >
    </div>
  </div>
</article>

<style>
  .pinterest-preview {
    --native-bg: light-dark(#fff, #202020);
    --native-fg: light-dark(#111, #f5f5f5);
    --native-muted: light-dark(#5f5f5f, #b5b5b5);
    width: min(100%, 28rem);
    overflow: hidden;
    border: 1px solid light-dark(#e9e9e9, #3a3a3a);
    border-radius: 1.5rem;
    background: var(--native-bg);
    color: var(--native-fg);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .pin-image :global(.media-tile) {
    max-height: 40rem;
  }
  .pin-details {
    display: grid;
    gap: 0.7rem;
    padding: 1rem;
  }
  .pin-toolbar {
    display: flex;
    align-items: center;
    gap: 1.2rem;
  }
  .pin-toolbar :global(svg) {
    width: 1.4rem;
    height: 1.4rem;
  }
  .save {
    margin-left: auto;
    border-radius: 999px;
    background: #e60023;
    color: #fff;
    padding: 0.8rem 1.1rem;
    font-size: 0.9rem;
    font-weight: 600;
  }
  .domain {
    font-size: 0.8rem;
    text-decoration: underline;
    overflow-wrap: anywhere;
  }
  h2 {
    margin: 0;
    font-size: 1.5rem;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }
  p {
    margin: 0;
    font-size: 0.9rem;
    line-height: 1.45;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .author {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.82rem;
  }
  .author strong {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .compact .pin-details {
    gap: 0.5rem;
    padding: 0.75rem;
  }
</style>
