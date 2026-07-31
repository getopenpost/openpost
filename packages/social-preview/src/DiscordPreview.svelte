<script lang="ts">
  import MoreHorizontal from "@lucide/svelte/icons/ellipsis";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Reply from "@lucide/svelte/icons/reply";
  import SmilePlus from "@lucide/svelte/icons/smile-plus";
  import type { PreviewModel } from "./model";
  import PreviewAttachment from "./PreviewAttachment.svelte";
  import PreviewAvatar from "./PreviewAvatar.svelte";
  import PreviewMedia from "./PreviewMedia.svelte";

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
    {@const media = segment.media?.length
      ? segment.media
      : index === 0
        ? model.media
        : []}
    <div class="message">
      <PreviewAvatar identity={model.identity} size={40} />
      <div class="message-body">
        <header>
          <strong>{model.identity.displayName}</strong>
          <span class="app-badge">APP</span>
          <span>Today at {model.createdAtLabel}</span>
        </header>
        <p>{segment.text || "Your message will appear here."}</p>
        {#if index === 0 && model.card}<PreviewAttachment
            card={model.card}
            platform="discord"
          />{/if}
        {#if media.length > 0}
          <PreviewMedia {media} layout="discord" />
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
  .discord-preview {
    --native-bg: #313338;
    --native-surface: #313338;
    --native-fg: #f2f3f5;
    --native-muted: #b5bac1;
    --native-border: #4e5058;
    width: min(100%, 42rem);
    overflow: hidden;
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
    padding: 0.2rem 1rem 0.65rem;
  }

  .message:hover {
    background: #2e3035;
  }

  .message + .message {
    margin-top: 0.45rem;
  }

  .message-body {
    min-width: 0;
  }

  header {
    display: flex;
    min-width: 0;
    align-items: baseline;
    gap: 0.4rem;
  }

  header strong {
    overflow: hidden;
    color: #f2f3f5;
    font-size: 0.9rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  header > span {
    color: var(--native-muted);
    font-size: 0.68rem;
  }

  .app-badge {
    border-radius: 0.18rem;
    background: #5865f2;
    color: white;
    padding: 0.08rem 0.25rem;
    font-size: 0.58rem;
    font-weight: 700;
    line-height: 1.2;
  }

  p {
    margin: 0.15rem 0 0;
    color: #dbdee1;
    font-size: 0.9rem;
    line-height: 1.4;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .message-body :global(.single-media) {
    margin-top: 0.5rem;
  }

  .message-actions {
    position: absolute;
    z-index: 2;
    top: -1.05rem;
    right: 0.8rem;
    display: none;
    overflow: hidden;
    border: 1px solid #26272d;
    border-radius: 0.35rem;
    background: #2b2d31;
    box-shadow: 0 2px 5px rgb(0 0 0 / 25%);
  }

  .message:hover .message-actions {
    display: flex;
  }

  .message-actions :global(svg) {
    width: 2rem;
    height: 2rem;
    padding: 0.45rem;
    color: var(--native-muted);
  }

  .compact .message {
    gap: 0.7rem;
    padding-inline: 0.75rem;
  }

  @media (max-width: 32rem) {
    .message {
      gap: 0.7rem;
      padding-inline: 0.75rem;
    }

    .message-actions {
      position: static;
      display: flex;
      grid-column: 2;
      width: max-content;
      margin-top: -0.35rem;
    }
  }
</style>
