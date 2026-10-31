<script lang="ts">
  import { previewEditing } from "./editing";
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import Heart from "@lucide/svelte/icons/heart";
  import Upload from "@lucide/svelte/icons/upload";
  import type { PreviewModel } from "./model";
  import PreviewAvatar from "./PreviewAvatar.svelte";
  import PreviewMedia from "./PreviewMedia.svelte";

  const editing = previewEditing();

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
      <Heart aria-label="React" /><Upload aria-label="Share" /><Ellipsis
        aria-label="More"
      />
      <span class="save">Save</span>
    </div>
    {#if model.card?.domain}<span class="domain">{model.card.domain}</span>{/if}
    {#if model.title || editing()?.title}<h2 dir="auto">{#if editing()?.title && primary}{@render editing()!.title!(model.title ?? "", primary)}{:else}{model.title}{/if}</h2>{/if}
    {#if editing()?.text && primary}{@render editing()!.text(primary)}{:else if primary?.text}<p dir="auto">{primary.text}</p>{/if}
    <div class="author">
      <PreviewAvatar identity={model.identity} size={32} />
      <strong>{model.identity.displayName}</strong>
      <span class="follow">Follow</span>
    </div>
    <div class="comments" aria-hidden="true">
      <span class="comment-count">0 Comments</span>
      <div class="comment-input">
        <PreviewAvatar identity={model.identity} size={28} />
        <span>Add a comment</span>
      </div>
    </div>
  </div>
</article>

<style>
  .pinterest-preview {
    --native-bg: light-dark(#fff, #202020);
    --native-fg: light-dark(#111, #f5f5f5);
    --native-muted: light-dark(#5f5f5f, #b5b5b5);
    --native-soft: light-dark(#f2f2f2, #2e2e2e);
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
    unicode-bidi: plaintext;
    text-align: start;
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
  .follow {
    flex: none;
    margin-left: auto;
    border: 1px solid light-dark(#111, #f5f5f5);
    border-radius: 999px;
    padding: 0.35rem 0.9rem;
    font-size: 0.78rem;
    font-weight: 700;
  }
  .comments {
    display: grid;
    gap: 0.7rem;
    padding-top: 0.3rem;
  }
  .comment-count {
    color: var(--native-muted);
    font-size: 0.85rem;
    font-weight: 700;
  }
  .comment-input {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .comment-input > span:last-child {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    border-bottom: 1px solid light-dark(#e9e9e9, #3a3a3a);
    color: var(--native-muted);
    font-size: 0.8rem;
    padding-block: 0.45rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .compact .pin-details {
    gap: 0.5rem;
    padding: 0.75rem;
  }
  /* The real closeup places the image beside its details whenever the
     container is wide, and stacks them on phones and composer cards. */
  @container (min-width: 40rem) {
    .pinterest-preview {
      display: grid;
      grid-template-columns: minmax(0, 1.5fr) minmax(16rem, 1fr);
      width: min(100%, 60rem);
    }
    .pin-image {
      display: grid;
      min-height: 20rem;
      border-radius: 2rem;
      overflow: hidden;
    }
    .pin-image :global(.media-tile) {
      height: 100%;
      max-height: 42rem;
    }
    .pin-image :global(.media-tile img) {
      height: 100%;
      object-fit: cover;
    }
    .pin-details {
      align-content: start;
      gap: 0.8rem;
      padding: 1.5rem 1.75rem;
    }
    .pin-toolbar {
      gap: 0.9rem;
    }
    h2 {
      font-size: 1.4rem;
    }
  }
</style>
