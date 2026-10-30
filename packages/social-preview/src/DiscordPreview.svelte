<script lang="ts">
  import { previewEditing } from "./editing";
  import MoreHorizontal from "@lucide/svelte/icons/ellipsis";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Reply from "@lucide/svelte/icons/reply";
  import SmilePlus from "@lucide/svelte/icons/smile-plus";
  import type { PreviewModel } from "./model";
  import PreviewAttachment from "./PreviewAttachment.svelte";
  import PreviewAvatar from "./PreviewAvatar.svelte";
  import PreviewMedia from "./PreviewMedia.svelte";

  const editing = previewEditing();

  interface Props {
    model: PreviewModel;
    compact?: boolean;
  }

  let { model, compact = false }: Props = $props();
  const segments = $derived(
    model.format === "thread" ? model.segments : model.segments.slice(0, 1),
  );
</script>

<article class={["discord-preview", compact && "compact"]}>
  {#each segments as segment, index (segment.id)}
    {@const media = segment.media ?? (index === 0 ? model.media : [])}
    <div class="message">
      <PreviewAvatar identity={model.identity} size={40} />
      <div class="message-body">
        <header>
          <strong>{model.identity.displayName}</strong>
          <span class="app-badge">APP</span>
          <span>{model.createdAtLabel}</span>
        </header>
        {#if editing()?.text}{@render editing()!.text(segment)}{:else if segment.text}<p dir="auto">{segment.text}</p>{/if}
        {#if segment.card ?? (index === 0 ? model.card : undefined)}<PreviewAttachment {segment}
            card={(segment.card ?? model.card)!}
            platform="discord"
          />{/if}
        {#if media.length > 0}
          <PreviewMedia {media} {segment} layout="discord" />
        {:else if index === 0 && model.format === "video"}
          <PreviewMedia
            media={[]}
            layout="discord"
            emptyLabel="Video preview"
          />
        {/if}
      </div>
      <div class="message-actions" aria-label="Message actions">
        <SmilePlus aria-label="Add reaction" />
        <Reply aria-label="Reply" />
        <Pencil aria-label="Edit" />
        <MoreHorizontal aria-label="More" />
      </div>
    </div>
  {/each}
</article>

<style>
  /* Discord client tokens: dark theme --background-primary/--text-normal and
     light theme equivalents, resolved through light-dark(). */
  .discord-preview {
    --native-bg: light-dark(#fff, #313338);
    --native-surface: light-dark(#fff, #313338);
    --native-soft: light-dark(#f2f3f5, #2b2d31);
    --native-fg: light-dark(#313338, #dbdee1);
    --native-heading: light-dark(#060607, #f2f3f5);
    --native-muted: light-dark(#5c5e66, #949ba4);
    --native-border: light-dark(#dfe1e5, #4e5058);
    --native-link: light-dark(#006ce7, #00a8fc);
    --native-accent: #5865f2;
    --native-floating: light-dark(#fff, #111214);
    width: min(100%, 42rem);
    overflow: hidden;
    padding-top: 0.875rem;
    background: var(--native-bg);
    color: var(--native-fg);
    font-family:
      "gg sans", "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif;
  }

  .message {
    position: relative;
    display: grid;
    grid-template-columns: 2.5rem minmax(0, 1fr);
    gap: 1rem;
    padding: 0.25rem 1rem;
  }

  .message:hover {
    background: light-dark(#f7f7f7, #2e3035);
  }

  .message-body {
    min-width: 0;
  }

  header {
    display: flex;
    min-width: 0;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0 0.5rem;
    font-size: 1rem;
    line-height: 1.25;
  }

  header strong {
    overflow: hidden;
    color: var(--native-heading);
    font-size: 1rem;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  header > span {
    color: var(--native-muted);
    font-size: 0.75rem;
    font-weight: 500;
  }

  .app-badge {
    align-self: center;
    border-radius: 3px;
    background: var(--native-accent);
    color: #fff;
    padding: 0 0.3rem;
    font-size: 0.625rem;
    font-weight: 600;
    line-height: 0.9375rem;
    text-transform: uppercase;
  }

  p {
    margin: 0.125rem 0 0;
    color: var(--native-fg);
    font-size: 1rem;
    line-height: 1.375;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    unicode-bidi: plaintext;
    text-align: start;
  }

  .message-body :global(.empty-media) {
    margin-top: 0.5rem;
  }

  /* Attachment mosaics: 4px corners and Discord's 400x300 inline-attachment
     box; single media letterboxes inside the box like the real client. */
  .message-body :global(.attachment-gallery) {
    width: min(100%, 25rem);
  }

  .message-body :global(.mosaic) {
    border-radius: 4px;
  }

  .message-body :global(.mosaic .media-tile) {
    border-radius: 4px;
  }

  .message-body :global(.attachment-gallery .mosaic.single .media-tile) {
    max-height: 18.75rem;
    background: transparent;
  }

  .message-body :global(.attachment-gallery .mosaic.single .media-tile img),
  .message-body :global(.attachment-gallery .mosaic.single .media-tile video) {
    object-fit: contain;
  }

  .message-body :global(.file-attachment) {
    border-radius: 4px;
  }

  /* Link cards render like channel embeds: blurple title, muted provider. */
  .message-body :global(.platform-discord .link-copy) {
    padding: 0.5rem 0.875rem 0.625rem 0.75rem;
  }

  .message-body :global(.platform-discord .link-copy > span) {
    color: light-dark(#4e5058, #b5bac1);
    font-size: 0.75rem;
    font-weight: 600;
  }

  .message-body :global(.platform-discord .link-copy > strong) {
    color: var(--native-link);
    font-size: 1rem;
    font-weight: 600;
  }

  .message-body :global(.platform-discord .link-copy > p) {
    color: var(--native-fg);
    font-size: 0.875rem;
  }

  .message-actions {
    position: absolute;
    z-index: 2;
    top: -0.875rem;
    right: 1rem;
    display: none;
    overflow: hidden;
    padding: 0.125rem;
    border-radius: 0.5rem;
    background: var(--native-floating);
    box-shadow: 0 8px 16px light-dark(rgb(0 0 0 / 16%), rgb(0 0 0 / 24%));
  }

  .message:hover .message-actions {
    display: flex;
  }

  .message-actions :global(svg) {
    box-sizing: border-box;
    width: 2rem;
    height: 2rem;
    padding: 0.375rem;
    border-radius: 4px;
    color: light-dark(#4e5058, #b5bac1);
  }

  .message-actions :global(svg:hover) {
    background: rgb(109 111 120 / 30%);
    color: var(--native-heading);
  }

  .compact .message {
    gap: 0.7rem;
    padding-inline: 0.75rem;
  }

  @container (max-width: 32rem) {
    .message {
      gap: 0.7rem;
      padding-inline: 0.75rem;
    }

    .message-actions {
      position: static;
      display: none;
      grid-column: 2;
      width: max-content;
      margin-top: -0.35rem;
      box-shadow: none;
    }
  }
</style>
