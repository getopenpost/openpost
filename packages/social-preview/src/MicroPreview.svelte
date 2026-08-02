<script lang="ts">
  import Globe2 from "@lucide/svelte/icons/globe-2";
  import LockKeyhole from "@lucide/svelte/icons/lock-keyhole";
  import MoreHorizontal from "@lucide/svelte/icons/ellipsis";
  import type {
    PreviewMedia,
    PreviewModel,
    PreviewPlatform,
    PreviewSegment,
  } from "./model";
  import PreviewActions from "./PreviewActions.svelte";
  import PreviewAttachment from "./PreviewAttachment.svelte";
  import PreviewAvatar from "./PreviewAvatar.svelte";
  import PreviewMediaView from "./PreviewMedia.svelte";
  import PreviewPollView from "./PreviewPoll.svelte";
  import VerifiedBadge from "./VerifiedBadge.svelte";

  type MicroPlatform = Extract<
    PreviewPlatform,
    "x" | "mastodon" | "bluesky" | "threads"
  >;

  interface Props {
    model: PreviewModel;
    platform: MicroPlatform;
    compact?: boolean;
  }

  let { model, platform, compact = false }: Props = $props();
  let revealedWarning = $state<string | null>(null);

  const handle = $derived(model.identity.handle.replace(/^@/u, ""));
  const isThread = $derived(
    model.format === "thread" && model.segments.length > 1,
  );
  const warningHidden = $derived(
    Boolean(model.contentWarning && revealedWarning !== model.contentWarning),
  );

  function mediaForSegment(
    segment: PreviewSegment,
    index: number,
  ): PreviewMedia[] {
    return segment.media?.length
      ? segment.media
      : index === 0
        ? model.media
        : [];
  }
</script>

{#snippet authorMeta()}
  <div class="author-meta">
    <div class="name-line">
      <strong>{model.identity.displayName}</strong>
      {#if model.identity.verified}<VerifiedBadge {platform} />{/if}
      {#if platform !== "threads"}<span>@{handle}</span>{/if}
      {#if platform === "x" || platform === "bluesky"}<span
          >· {model.createdAtLabel}</span
        >{/if}
    </div>
    {#if platform === "mastodon"}
      <span class="mastodon-handle">@{handle}</span>
    {/if}
  </div>
{/snippet}

{#snippet contentWarning()}
  {#if model.contentWarning}
    <div class="content-warning">
      <div>
        <strong
          >{platform === "mastodon"
            ? model.contentWarning
            : "Hidden words"}</strong
        >
        {#if platform === "mastodon"}<span>Content warning</span>{/if}
      </div>
      <button
        type="button"
        onclick={() =>
          (revealedWarning = warningHidden
            ? (model.contentWarning ?? null)
            : null)}
      >
        {warningHidden ? "Show more" : "Hide"}
      </button>
    </div>
  {/if}
{/snippet}

{#snippet postBody(segment: PreviewSegment, index: number)}
  {#if index === 0}{@render contentWarning()}{/if}
  {#if !warningHidden}
    <p class="post-text">{segment.text || "Your post will appear here."}</p>
    {#if index === 0 && model.card}<PreviewAttachment
        card={model.card}
        {platform}
      />{/if}
    {#if index === 0 && model.poll}<PreviewPollView
        poll={model.poll}
        {platform}
      />{/if}
    {@const segmentMedia = mediaForSegment(segment, index)}
    {#if segmentMedia.length > 0}
      <PreviewMediaView media={segmentMedia} layout="grid" />
    {/if}
  {/if}
{/snippet}

{#snippet mastodonVisibility()}
  <span class="visibility" title={model.visibility || "Public"}>
    {#if model.visibility === "private" || model.visibility === "direct"}
      <LockKeyhole aria-hidden="true" />
    {:else}
      <Globe2 aria-hidden="true" />
    {/if}
  </span>
{/snippet}

<article
  class={[
    "micro-preview",
    `platform-${platform}`,
    isThread && "is-thread",
    compact && "compact",
  ]}
>
  {#each isThread ? model.segments : model.segments.slice(0, 1) as segment, index (segment.id)}
    <section class="micro-post">
      <div class="avatar-column">
        <PreviewAvatar
          identity={model.identity}
          size={platform === "mastodon" ? 46 : platform === "x" ? 40 : 42}
        />
        {#if isThread && index < model.segments.length - 1}<span
            class="thread-line"
            aria-hidden="true"
          ></span>{/if}
      </div>

      {#if platform === "mastodon"}
        <div class="mastodon-post">
          <header>
            {@render authorMeta()}
            <div class="post-time">
              {@render mastodonVisibility()}
              <span>{model.createdAtLabel}</span>
            </div>
          </header>
          {@render postBody(segment, index)}
          <PreviewActions {platform} {compact} />
        </div>
      {:else}
        <div class="post-column">
          <header>
            {@render authorMeta()}
            <MoreHorizontal class="more" aria-hidden="true" />
          </header>
          {@render postBody(segment, index)}
          <PreviewActions {platform} {compact} />
        </div>
      {/if}
    </section>
  {/each}
</article>

<style>
  .micro-preview {
    --native-bg: #fff;
    --native-surface: #fff;
    --native-fg: #0f1419;
    --native-muted: #536471;
    --native-border: #eff3f4;
    width: min(100%, 37.5rem);
    overflow: hidden;
    border: 1px solid var(--native-border);
    background: var(--native-bg);
    color: var(--native-fg);
    font-family:
      -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial,
      sans-serif;
  }

  .micro-post {
    position: relative;
    display: grid;
    grid-template-columns: 2.65rem minmax(0, 1fr);
    gap: 0.65rem;
    padding: 0.75rem 1rem 0.35rem;
    border-bottom: 1px solid var(--native-border);
  }

  .micro-post:last-child {
    border-bottom: 0;
  }

  .avatar-column {
    position: relative;
    z-index: 1;
  }

  .thread-line {
    position: absolute;
    z-index: -1;
    top: 3rem;
    bottom: -0.85rem;
    left: 50%;
    width: 2px;
    translate: -50% 0;
    background: var(--native-border);
  }

  .post-column,
  .mastodon-post {
    min-width: 0;
  }

  header {
    display: flex;
    min-width: 0;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .author-meta {
    min-width: 0;
    flex: 1;
  }

  .name-line {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.93rem;
    line-height: 1.35;
  }

  .name-line strong,
  .name-line span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name-line strong {
    color: var(--native-fg);
    font-weight: 700;
  }

  .name-line span,
  .mastodon-handle,
  .post-time {
    color: var(--native-muted);
    font-size: 0.9rem;
  }

  .more {
    width: 1.2rem;
    height: 1.2rem;
    flex: 0 0 auto;
    color: var(--native-muted);
  }

  .post-text {
    margin: 0.12rem 0 0.65rem;
    color: var(--native-fg);
    font-size: 0.94rem;
    line-height: 1.34;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .post-column :global(.media-grid),
  .mastodon-post :global(.media-grid) {
    margin-top: 0.65rem;
  }

  .post-column > :global(.preview-actions),
  .mastodon-post > :global(.preview-actions) {
    margin-top: 0.2rem;
  }

  .content-warning {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin: 0.35rem 0 0.7rem;
    border-radius: 0.65rem;
    background: var(--native-soft, #f3f4f6);
    padding: 0.65rem 0.75rem;
  }

  .content-warning > div {
    display: grid;
    gap: 0.1rem;
  }

  .content-warning strong {
    font-size: 0.82rem;
  }

  .content-warning span {
    color: var(--native-muted);
    font-size: 0.72rem;
  }

  .content-warning button {
    min-height: 2.25rem;
    flex: 0 0 auto;
    border: 0;
    border-radius: 999px;
    background: var(--native-fg);
    color: var(--native-bg);
    padding: 0 0.75rem;
    font: inherit;
    font-size: 0.75rem;
    font-weight: 700;
    cursor: pointer;
  }

  .platform-x .micro-post {
    grid-template-columns: 2.5rem minmax(0, 1fr);
    padding-block: 0.75rem 0.15rem;
  }

  .platform-x .post-text {
    font-size: 0.95rem;
    line-height: 1.3;
  }

  .platform-bluesky {
    --native-fg: #101827;
    --native-muted: #68788a;
    --native-border: #e5eaf0;
  }

  .platform-bluesky .micro-post {
    grid-template-columns: 2.65rem minmax(0, 1fr);
    padding: 0.65rem 0.95rem 0.25rem 1.1rem;
  }

  .platform-bluesky .post-text {
    margin-top: 0.25rem;
    font-size: 0.95rem;
    line-height: 1.4;
  }

  .platform-mastodon {
    --native-bg: #282c37;
    --native-surface: #282c37;
    --native-fg: #f5f5f7;
    --native-muted: #9baec8;
    --native-border: #393f4f;
    --native-soft: #333846;
    width: min(100%, 34rem);
    border-radius: 0.3rem;
    font-family:
      mastodon-font-sans-serif,
      -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      sans-serif;
  }

  .platform-mastodon .micro-post {
    grid-template-columns: 2.9rem minmax(0, 1fr);
    gap: 0.55rem;
    padding: 1rem;
  }

  .platform-mastodon header {
    align-items: center;
    padding-bottom: 0.65rem;
  }

  .platform-mastodon .name-line {
    display: block;
    font-size: 0.94rem;
    line-height: 1.25;
  }

  .platform-mastodon .mastodon-handle {
    display: block;
    margin-top: 0.1rem;
    font-size: 0.78rem;
  }

  .post-time {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 0.25rem;
  }

  .visibility {
    display: grid;
    place-items: center;
  }

  .visibility :global(svg) {
    width: 0.8rem;
    height: 0.8rem;
  }

  .platform-mastodon .post-text {
    margin-top: 0;
    font-size: 0.94rem;
    line-height: 1.45;
  }

  .platform-mastodon .thread-line {
    background: #505766;
  }

  .platform-threads {
    --native-fg: #101010;
    --native-muted: #777;
    --native-border: #e9e9e9;
    width: min(100%, 39.5rem);
    border-radius: 1rem;
  }

  .platform-threads .micro-post {
    grid-template-columns: 2.5rem minmax(0, 1fr);
    gap: 0.75rem;
    padding: 0.9rem 1rem 0.25rem;
  }

  .platform-threads .name-line strong {
    font-size: 0.88rem;
  }

  .platform-threads .name-line span {
    margin-left: 0.15rem;
    font-size: 0.84rem;
  }

  .platform-threads .post-text {
    margin-top: 0.15rem;
    font-size: 0.94rem;
    line-height: 1.42;
  }

  .compact .micro-post {
    padding-inline: 0.75rem;
  }

  @media (prefers-color-scheme: dark) {
    .platform-x,
    .platform-bluesky,
    .platform-threads {
      --native-bg: #000;
      --native-surface: #000;
      --native-fg: #f2f2f2;
      --native-muted: #71767b;
      --native-border: #2f3336;
      --native-soft: #16181c;
    }

    .platform-bluesky {
      --native-bg: #111822;
      --native-surface: #111822;
      --native-muted: #9aa8b8;
      --native-border: #273344;
    }

    .platform-threads {
      --native-bg: #0a0a0a;
      --native-surface: #0a0a0a;
      --native-border: #2d2d2d;
    }
  }

  :global(.dark) .platform-x,
  :global(.dark) .platform-bluesky,
  :global(.dark) .platform-threads {
    --native-bg: #000;
    --native-surface: #000;
    --native-fg: #f2f2f2;
    --native-muted: #71767b;
    --native-border: #2f3336;
    --native-soft: #16181c;
  }

  :global(.dark) .platform-bluesky {
    --native-bg: #111822;
    --native-surface: #111822;
    --native-muted: #9aa8b8;
    --native-border: #273344;
  }

  :global(.dark) .platform-threads {
    --native-bg: #0a0a0a;
    --native-surface: #0a0a0a;
    --native-border: #2d2d2d;
  }

  @media (max-width: 32rem) {
    .micro-preview,
    .platform-mastodon,
    .platform-threads {
      border-inline: 0;
      border-radius: 0;
    }

    .micro-post {
      padding-inline: 0.75rem;
    }

    .name-line strong,
    .name-line span {
      font-size: 0.84rem;
    }
  }
</style>
