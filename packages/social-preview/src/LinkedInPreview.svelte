<script lang="ts">
  import { previewEditing } from "./editing";
  import Globe2 from "@lucide/svelte/icons/globe-2";
  import MoreHorizontal from "@lucide/svelte/icons/ellipsis";
  import type { PreviewModel, PreviewSegment } from "./model";
  import PreviewActions from "./PreviewActions.svelte";
  import PreviewAttachment from "./PreviewAttachment.svelte";
  import PreviewAvatar from "./PreviewAvatar.svelte";
  import PreviewMedia from "./PreviewMedia.svelte";
  import PreviewPoll from "./PreviewPoll.svelte";
  import VerifiedBadge from "./VerifiedBadge.svelte";
  import PreviewText from "./PreviewText.svelte";

  const editing = previewEditing();

  interface Props {
    model: PreviewModel;
    compact?: boolean;
  }

  let { model, compact = false }: Props = $props();
  const primary = $derived(model.segments[0] ?? { id: "primary", text: "" });
  const primaryMedia = $derived(primary.media ?? model.media);
  const displayMedia = $derived(
    model.format === "document" && model.title
      ? primaryMedia.map((item) =>
          item.kind === "document" ? { ...item, alt: model.title } : item,
        )
      : primaryMedia,
  );
  const replies = $derived(
    model.format === "thread" ? model.segments.slice(1) : [],
  );
</script>

{#snippet postText(segment: PreviewSegment)}
  <div class="post-text">
    {#if editing()?.text}{@render editing()!.text(segment)}{:else}<PreviewText text={segment.text || "Your post will appear here."} lines={2} buttonLabel="… more" />{/if}
  </div>
{/snippet}

<article class={["linkedin-preview", compact && "compact"]}>
  <header class="post-header">
    <PreviewAvatar identity={model.identity} size={48} />
    <div class="identity">
      <div class="name">
        <strong>{model.identity.displayName}</strong>
        {#if model.identity.verified}<VerifiedBadge platform="linkedin" />{/if}
        <span>· You</span>
      </div>
      {#if model.subtitle}<span>{model.subtitle}</span>{/if}
      <span class="timestamp"
        >{model.createdAtLabel} · <Globe2 aria-label="Public" /></span
      >
    </div>
    <span class="more"><MoreHorizontal aria-hidden="true" /></span>
  </header>

  <div class="post-body">
    {#if model.title && model.format !== "document"}<h3 dir="auto">{model.title}</h3>{/if}
    {@render postText(primary)}
  </div>

  {#if primary.card ?? model.card}<PreviewAttachment segment={primary}
      card={(primary.card ?? model.card)!}
      platform="linkedin"
    />{/if}
  {#if primary.poll ?? model.poll}
    <div class="poll-wrap">
      <PreviewPoll segment={primary} poll={(primary.poll ?? model.poll)!} platform="linkedin" />
    </div>
  {/if}

  {#if displayMedia.length > 0}
    <PreviewMedia
      media={displayMedia}
      layout={model.format === "document" ||
      displayMedia[0]?.kind === "document"
        ? "document"
        : displayMedia.length > 1
          ? "facebook"
          : "single"}
    />
  {:else if model.format === "video"}
    <PreviewMedia media={[]} layout="single" emptyLabel="Video preview" />
  {:else if model.format === "document"}
    <div class="empty-document">
      <span>1</span>
      <strong>{model.title || "Your document title"}</strong>
      <small>PDF</small>
    </div>
  {/if}

  <div class="engagement" aria-hidden="true">
    <span class="reaction-cluster"><i>👍</i><i>♥</i><i>👏</i></span>
    <span>0</span>
    <span class="right">0 comments · 0 reposts</span>
  </div>
  <div class="action-row">
    <div class="actions"><PreviewActions platform="linkedin" {compact} /></div>
  </div>

  {#if replies.length > 0}
    <div class="comment-thread">
      {#each replies as reply (reply.id)}
        <div class="comment">
          <PreviewAvatar identity={model.identity} size={32} />
          <div>
            <div class="comment-bubble">
              <strong>{model.identity.displayName}</strong>
              <span>Author</span>
              {@render postText(reply)}
              {#if reply.card}<PreviewAttachment segment={reply}
                  card={reply.card}
                  platform="linkedin"
                />{/if}
              {#if reply.poll}<PreviewPoll segment={reply}
                  poll={reply.poll}
                  platform="linkedin"
                />{/if}
              {#if reply.media?.length}<PreviewMedia
                  media={reply.media}
                segment={reply}
                  layout="grid"
                />{/if}
            </div>
            <small>Like · Reply · {model.createdAtLabel}</small>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</article>

<style>
  .linkedin-preview {
    --native-bg: light-dark(#f4f2ee, #000);
    --native-surface: light-dark(#fff, #1b1f23);
    --native-fg: light-dark(rgb(0 0 0 / 90%), rgb(255 255 255 / 90%));
    --native-muted: light-dark(rgb(0 0 0 / 60%), rgb(255 255 255 / 60%));
    --native-border: light-dark(#e0dfdc, #38434f);
    --native-soft: light-dark(#eef3f8, #2a2e33);
    width: min(100%, 34.5rem);
    overflow: hidden;
    border: 1px solid var(--native-border);
    border-radius: 0.5rem;
    background: var(--native-surface);
    color: var(--native-fg);
    font-family:
      -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto,
      Helvetica, Arial, sans-serif;
  }

  .post-header {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 0.65rem;
    padding: 0.75rem 1rem 0.45rem;
  }

  .identity {
    display: grid;
    min-width: 0;
    align-content: start;
  }

  .name {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.875rem;
    line-height: 1.25;
  }

  .name strong {
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name span,
  .identity > span {
    color: var(--native-muted);
    font-size: 0.75rem;
    line-height: 1.35;
  }

  .timestamp {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
  }

  .timestamp :global(svg) {
    width: 0.75rem;
    height: 0.75rem;
  }

  .more {
    color: var(--native-muted);
  }

  .more :global(svg) {
    width: 1.25rem;
    height: 1.25rem;
  }

  .post-body {
    padding: 0.35rem 1rem 0.8rem;
  }

  .post-body h3 {
    margin: 0 0 0.45rem;
    font-size: 1rem;
    line-height: 1.35;
  }

  .post-text {
    margin: 0;
    color: var(--native-fg);
    font-size: 0.875rem;
    line-height: 1.45;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .poll-wrap {
    padding: 0 1rem 0.75rem;
  }

  .poll-wrap :global(.poll-option) {
    min-height: 3rem;
    border-radius: 0.15rem;
    font-size: 0.875rem;
    font-weight: 600;
  }

  .poll-wrap :global(small) {
    font-size: 0.75rem;
  }

  .empty-document {
    display: grid;
    min-height: 20rem;
    place-items: center;
    align-content: center;
    gap: 0.6rem;
    border-block: 1px solid var(--native-border);
    background:
      linear-gradient(90deg, #e9e5df 2.5rem, transparent 2.5rem),
      repeating-linear-gradient(#fff 0 1.7rem, #e8e6e2 1.7rem 1.76rem);
    padding: 2rem;
    text-align: center;
  }

  .empty-document > span {
    display: grid;
    width: 2rem;
    height: 2rem;
    place-items: center;
    border-radius: 50%;
    background: #0a66c2;
    color: #fff;
    font-size: 0.8rem;
    font-weight: 700;
  }

  .empty-document strong {
    max-width: 24ch;
    font-size: 1.2rem;
  }

  .empty-document small {
    color: var(--native-muted);
    font-size: 0.7rem;
    font-weight: 700;
  }

  .reaction-cluster {
    display: flex;
  }

  .reaction-cluster i {
    display: grid;
    width: 1.125rem;
    height: 1.125rem;
    place-items: center;
    margin-right: -0.25rem;
    border: 2px solid var(--native-surface);
    border-radius: 50%;
    background: #378fe9;
    color: white;
    font-size: 0.55rem;
    font-style: normal;
  }

  .reaction-cluster i:nth-child(2) {
    background: #df704d;
  }

  .reaction-cluster i:nth-child(3) {
    background: #6dae4f;
  }

  .engagement {
    display: flex;
    min-height: 2.2rem;
    align-items: center;
    gap: 0.35rem;
    margin-inline: 1rem;
    padding: 0.1rem 0 0.3rem;
    border-bottom: 1px solid var(--native-border);
    color: var(--native-muted);
    font-size: 0.78rem;
  }

  .engagement .right {
    margin-left: auto;
  }

  .action-row {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    min-height: 2.5rem;
    padding: 0 0.85rem;
  }

  .actions {
    flex: 1;
    min-width: 0;
  }

  .actions :global(.action) {
    font-size: 0.875rem;
  }

  .comment-thread {
    display: grid;
    gap: 0.75rem;
    border-top: 1px solid var(--native-border);
    padding: 0.85rem 1rem 1rem;
  }

  .comment {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.45rem;
  }

  .comment-bubble {
    display: grid;
    gap: 0.15rem;
    border-radius: 0 0.7rem 0.7rem;
    background: light-dark(#f2f2f2, #2a2e33);
    padding: 0.55rem 0.7rem;
  }

  .comment-bubble > strong {
    font-size: 0.75rem;
    font-weight: 600;
  }

  .comment-bubble > span {
    justify-self: start;
    border-radius: 0.125rem;
    background: #13707e;
    color: #fff;
    padding: 0.05rem 0.3rem;
    font-size: 0.6rem;
    font-weight: 600;
    line-height: 1.4;
  }

  .comment > div > small {
    color: var(--native-muted);
    font-size: 0.75rem;
    line-height: 1.35;
  }

  .comment-bubble .post-text {
    margin-top: 0.2rem;
    font-size: 0.75rem;
  }

  .comment > div > small {
    display: block;
    margin-top: 0.25rem;
    font-weight: 600;
  }

  .compact .post-header,
  .compact .post-body {
    padding-inline: 0.75rem;
  }

  @container (max-width: 32rem) {
    .linkedin-preview {
      border-inline: 0;
      border-radius: 0;
    }
  }
</style>
