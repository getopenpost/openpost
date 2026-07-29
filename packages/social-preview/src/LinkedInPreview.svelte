<script lang="ts">
  import Globe2 from "@lucide/svelte/icons/globe-2";
  import MoreHorizontal from "@lucide/svelte/icons/ellipsis";
  import type { PreviewModel, PreviewSegment } from "./model";
  import PreviewActions from "./PreviewActions.svelte";
  import PreviewAttachment from "./PreviewAttachment.svelte";
  import PreviewAvatar from "./PreviewAvatar.svelte";
  import PreviewMedia from "./PreviewMedia.svelte";
  import PreviewPoll from "./PreviewPoll.svelte";
  import VerifiedBadge from "./VerifiedBadge.svelte";

  interface Props {
    model: PreviewModel;
    compact?: boolean;
  }

  let { model, compact = false }: Props = $props();
  const primary = $derived(model.segments[0] ?? { id: "primary", text: "" });
  const primaryMedia = $derived(
    primary.media?.length ? primary.media : model.media,
  );
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
  <p class="post-text">{segment.text || "Your post will appear here."}</p>
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
      <span>@{model.identity.handle.replace(/^@/u, "")}</span>
      <span class="timestamp"
        >{model.createdAtLabel} · <Globe2 aria-label="Public" /></span
      >
    </div>
    <span class="more"><MoreHorizontal aria-hidden="true" /></span>
  </header>

  <div class="post-body">
    {#if model.title && model.format !== "document"}<h3>{model.title}</h3>{/if}
    {@render postText(primary)}
  </div>

  {#if model.card}<PreviewAttachment
      card={model.card}
      platform="linkedin"
    />{/if}
  {#if model.poll}
    <div class="poll-wrap">
      <PreviewPoll poll={model.poll} platform="linkedin" />
    </div>
  {/if}

  {#if displayMedia.length > 0}
    <PreviewMedia
      media={displayMedia}
      layout={model.format === "document" ||
      displayMedia[0]?.kind === "document"
        ? "document"
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

  <div class="engagement-summary">
    <span class="reaction-cluster" aria-hidden="true"
      ><i>👍</i><i>♥</i><i>👏</i></span
    >
    <span>0 reactions</span>
    <span class="engagement-right">0 comments · 0 reposts</span>
  </div>
  <div class="action-row"><PreviewActions platform="linkedin" {compact} /></div>

  {#if replies.length > 0}
    <div class="comment-thread">
      {#each replies as reply (reply.id)}
        <div class="comment">
          <PreviewAvatar identity={model.identity} size={34} />
          <div>
            <div class="comment-bubble">
              <strong>{model.identity.displayName}</strong>
              <span>Author</span>
              {@render postText(reply)}
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
    --native-bg: #f4f2ee;
    --native-surface: #fff;
    --native-fg: rgb(0 0 0 / 90%);
    --native-muted: rgb(0 0 0 / 60%);
    --native-border: #e0dfdc;
    --native-soft: #edf3f8;
    width: min(100%, 34.75rem);
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
    font-size: 0.88rem;
    line-height: 1.25;
  }

  .name strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name span,
  .identity > span {
    color: var(--native-muted);
    font-size: 0.73rem;
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
    color: var(--native-fg);
  }

  .more :global(svg) {
    width: 1.35rem;
    height: 1.35rem;
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
    font-size: 0.88rem;
    line-height: 1.45;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .poll-wrap {
    padding: 0 1rem 0.75rem;
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

  .engagement-summary {
    display: flex;
    min-height: 2.3rem;
    align-items: center;
    gap: 0.4rem;
    margin-inline: 1rem;
    border-bottom: 1px solid var(--native-border);
    color: var(--native-muted);
    font-size: 0.72rem;
  }

  .reaction-cluster {
    display: flex;
  }

  .reaction-cluster i {
    display: grid;
    width: 1rem;
    height: 1rem;
    place-items: center;
    margin-right: -0.16rem;
    border: 1px solid white;
    border-radius: 50%;
    background: #0a66c2;
    color: white;
    font-size: 0.54rem;
    font-style: normal;
  }

  .reaction-cluster i:nth-child(2) {
    background: #df704d;
  }

  .reaction-cluster i:nth-child(3) {
    background: #6dae4f;
  }

  .engagement-right {
    margin-left: auto;
  }

  .action-row {
    padding: 0.15rem 0.6rem;
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
    background: #f2f2f2;
    padding: 0.55rem 0.7rem;
  }

  .comment-bubble > strong {
    font-size: 0.76rem;
  }

  .comment-bubble > span,
  .comment > div > small {
    color: var(--native-muted);
    font-size: 0.66rem;
  }

  .comment-bubble .post-text {
    margin-top: 0.2rem;
    font-size: 0.8rem;
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

  @media (prefers-color-scheme: dark) {
    .linkedin-preview {
      --native-bg: #000;
      --native-surface: #1b1f23;
      --native-fg: rgb(255 255 255 / 90%);
      --native-muted: rgb(255 255 255 / 60%);
      --native-border: #38434f;
      --native-soft: #293138;
    }

    .comment-bubble {
      background: #293138;
    }
  }

  :global(.dark) .linkedin-preview {
    --native-bg: #000;
    --native-surface: #1b1f23;
    --native-fg: rgb(255 255 255 / 90%);
    --native-muted: rgb(255 255 255 / 60%);
    --native-border: #38434f;
    --native-soft: #293138;
  }

  :global(.dark) .comment-bubble {
    background: #293138;
  }

  @media (max-width: 32rem) {
    .linkedin-preview {
      border-inline: 0;
      border-radius: 0;
    }
  }
</style>
