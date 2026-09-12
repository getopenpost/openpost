<script lang="ts">
  import FileText from "@lucide/svelte/icons/file-text";
  import type { PreviewModel } from "./model";
  import PreviewAvatar from "./PreviewAvatar.svelte";
  import PreviewMedia from "./PreviewMedia.svelte";

  interface Props {
    model: PreviewModel;
    compact?: boolean;
  }

  let { model, compact = false }: Props = $props();
  const segment = $derived(model.segments[0]);
  const media = $derived(segment?.media?.length ? segment.media : model.media);
  const document = $derived(
    media.length === 1 && media[0]?.kind === "document" ? media[0] : undefined,
  );
</script>

<article
  class={["telegram-preview", compact && "compact"]}
  aria-label="Telegram channel message"
>
  <div class="message">
    <PreviewAvatar identity={model.identity} size={36} />
    <div class="bubble">
      <strong class="sender">{model.identity.displayName}</strong>
      {#if document}
        <div class="document">
          <span class="document-icon"><FileText aria-hidden="true" /></span>
          <span
            ><strong>{document.alt || "Document"}</strong><small
              >File attachment</small
            ></span
          >
        </div>
      {:else if media.length > 0}
        <PreviewMedia {media} layout={media.length > 1 ? "grid" : "single"} />
      {:else if model.format === "video"}
        <PreviewMedia media={[]} emptyLabel="Video preview" />
      {/if}
      <p>{segment?.text || "Your message will appear here."}</p>
      <footer>
        <span>{model.createdAtLabel}</span>
      </footer>
    </div>
  </div>
</article>

<style>
  .telegram-preview {
    width: min(100%, 42rem);
    min-height: 16rem;
    display: grid;
    align-content: end;
    padding: 1.5rem 1rem;
    background:
      radial-gradient(
        circle at 18% 30%,
        rgb(255 255 255 / 35%) 0 0.2rem,
        transparent 0.22rem
      ),
      radial-gradient(
        circle at 74% 68%,
        rgb(255 255 255 / 25%) 0 0.16rem,
        transparent 0.18rem
      ),
      #d8e5e4;
    color: #18242b;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .message {
    display: grid;
    grid-template-columns: 2.25rem minmax(0, 1fr);
    align-items: end;
    gap: 0.6rem;
    max-width: 36rem;
  }

  .bubble {
    min-width: 0;
    border-radius: 0.9rem 0.9rem 0.9rem 0.3rem;
    background: #fff;
    box-shadow: 0 1px 2px rgb(27 48 54 / 13%);
    padding: 0.55rem 0.65rem 0.4rem;
  }

  .sender {
    display: block;
    overflow: hidden;
    color: #2678a7;
    font-size: 0.82rem;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  p {
    margin: 0.3rem 0 0;
    font-size: 0.9rem;
    line-height: 1.45;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.2rem;
    margin-top: 0.2rem;
    color: #52636b;
    font-size: 0.66rem;
  }

  .bubble :global(.single-media),
  .bubble :global(.media-grid) {
    margin-top: 0.45rem;
    border-radius: 0.55rem;
  }

  .document {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    margin-top: 0.5rem;
    border-radius: 0.55rem;
    background: #f1f5f7;
    padding: 0.65rem;
  }

  .document-icon {
    display: grid;
    width: 2.5rem;
    height: 2.5rem;
    flex: none;
    place-items: center;
    border-radius: 0.4rem;
    background: #3390ec;
    color: white;
  }

  .document-icon :global(svg) {
    width: 1.3rem;
    height: 1.3rem;
  }

  .document span:last-child {
    display: grid;
    min-width: 0;
  }

  .document strong {
    overflow: hidden;
    font-size: 0.8rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .document small {
    color: #52636b;
    font-size: 0.7rem;
  }

  .compact {
    padding: 0.85rem 0.65rem;
  }

  @media (max-width: 32rem) {
    .telegram-preview {
      padding: 1rem 0.65rem;
    }

    .message {
      grid-template-columns: 2rem minmax(0, 1fr);
      gap: 0.4rem;
    }
  }
</style>
