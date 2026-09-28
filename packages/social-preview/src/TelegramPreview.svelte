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
  const media = $derived(segment?.media ?? model.media);
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
        <PreviewMedia {media} layout="album" />
      {:else if model.format === "video"}
        <PreviewMedia media={[]} emptyLabel="Video preview" />
      {/if}
      {#if segment?.text}<p dir="auto">{segment.text}</p>{/if}
      <footer>
        <span>{model.createdAtLabel}</span>
      </footer>
    </div>
  </div>
</article>

<style>
  .telegram-preview {
    --native-fg: light-dark(#18242b, #f5f5f5);
    --native-muted: light-dark(#52636b, #a1b3c1);
    --native-border: light-dark(#d8dde1, #34495b);
    --native-soft: light-dark(#f1f5f7, #20364b);
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
      light-dark(#d8e5e4, #0e1621);
    color: var(--native-fg);
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
    background: light-dark(#fff, #182533);
    box-shadow: 0 1px 2px rgb(27 48 54 / 13%);
    padding: 0.55rem 0.65rem 0.4rem;
  }

  .sender {
    display: block;
    overflow: hidden;
    color: light-dark(#2678a7, #6ab3f3);
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
    unicode-bidi: plaintext;
    text-align: start;
  }

  footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.2rem;
    margin-top: 0.2rem;
    color: var(--native-muted);
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
    background: var(--native-soft);
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
    color: var(--native-muted);
    font-size: 0.7rem;
  }

  .compact {
    padding: 0.85rem 0.65rem;
  }

  @container (max-width: 32rem) {
    .telegram-preview {
      padding: 1rem 0.65rem;
    }

    .message {
      grid-template-columns: 2rem minmax(0, 1fr);
      gap: 0.4rem;
    }
  }
</style>
