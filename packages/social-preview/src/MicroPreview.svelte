<script lang="ts">
  import { previewEditing } from "./editing";
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

  const editing = previewEditing();

  type MicroPlatform = Extract<
    PreviewPlatform,
    "x" | "mastodon" | "bluesky" | "threads" | "devnull"
  >;

  interface Props {
    model: PreviewModel;
    platform: MicroPlatform;
    compact?: boolean;
  }

  let { model, platform, compact = false }: Props = $props();
  let revealedWarnings = $state<Record<string, string | undefined>>({});

  const handle = $derived(model.identity.handle.replace(/^@/u, ""));
  const isThread = $derived(
    model.format === "thread" && model.segments.length > 1,
  );

  function mediaForSegment(
    segment: PreviewSegment,
    index: number,
  ): PreviewMedia[] {
    return segment.media ?? (index === 0 ? model.media : []);
  }

  /** /dev/null names every commit by its short hash. The preview model has no
   * server id, so derive a stable one from the commit body with FNV-1a: the
   * same text always hashes to the same 7 lowercase hex characters, and an
   * empty body keeps a fixed placeholder. Only read for platform "devnull". */
  const DEVNULL_EMPTY_COMMIT_HASH = "0000000";

  function devnullCommitHash(text: string): string {
    if (!text) {
      return DEVNULL_EMPTY_COMMIT_HASH;
    }
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 7);
  }
</script>

{#snippet authorMeta()}
  <div class="author-meta">
    <div class="name-line">
      <strong
        >{platform === "threads" ? handle : model.identity.displayName}</strong
      >
      {#if model.identity.verified}<VerifiedBadge {platform} />{/if}
      {#if platform === "x" || platform === "bluesky" || platform === "devnull"}<span>@{handle}</span
        >{/if}
      {#if platform !== "mastodon"}<span>· {model.createdAtLabel}</span>{/if}
    </div>
    {#if platform === "mastodon"}
      <span class="mastodon-handle">@{handle}</span>
    {/if}
  </div>
{/snippet}

{#snippet contentWarning(warning: string, segmentId: string)}
  {@const warningHidden = revealedWarnings[segmentId] !== warning}
  {#if warning}
    <div class="content-warning">
      <div>
        <strong>{warning}</strong>
        <span>Content warning</span>
      </div>
      <button
        type="button"
        aria-expanded={!warningHidden}
        onclick={() =>
          (revealedWarnings[segmentId] = warningHidden ? warning : undefined)}
      >
        {warningHidden ? "Show more" : "Hide"}
      </button>
    </div>
  {/if}
{/snippet}

{#snippet postBody(segment: PreviewSegment, index: number)}
  {@const warning =
    segment.contentWarning ?? (index === 0 ? model.contentWarning : undefined)}
  {@const card = segment.card ?? (index === 0 ? model.card : undefined)}
  {@const poll = segment.poll ?? (index === 0 ? model.poll : undefined)}
  {#if warning}{@render contentWarning(warning, segment.id)}{/if}
  {#if !warning || revealedWarnings[segment.id] === warning}
    {#if editing()?.text}<div class="post-text">{@render editing()!.text(segment)}</div>{:else if segment.text}<p class="post-text" dir="auto">{segment.text}</p>{/if}
    {#if card}<PreviewAttachment {card} {platform} {segment} />{/if}
    {#if poll}<PreviewPollView {poll} {platform} {segment} />{/if}
    {@const segmentMedia = mediaForSegment(segment, index)}
    {#if segmentMedia.length > 0}
      <PreviewMediaView
        media={segmentMedia}
        {segment}
        layout={platform === "threads" ? "carousel" : "grid"}
      />
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
          size={platform === "mastodon"
            ? 46
            : platform === "threads"
              ? 36
              : platform === "x" || platform === "devnull"
                ? 40
                : 42}
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
            {#if platform === "devnull"}
              {@const hash = devnullCommitHash(segment.text)}
              <span class="commit-hash" title={"Commit " + hash}>{hash}</span>
            {/if}
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
    flex-shrink: 0;
    max-width: 60%;
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
    unicode-bidi: plaintext;
    text-align: start;
  }

  .platform-threads :global(.media-carousel) {
    margin-top: 0.65rem;
    border-radius: 1rem;
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
    min-width: 0;
    overflow-wrap: anywhere;
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
    gap: 0.5rem;
    grid-template-columns: 2.5rem minmax(0, 1fr);
    padding-block: 0.75rem 0.15rem;
  }

  .platform-x .post-text {
    font-size: 0.95rem;
    line-height: 1.3;
  }

  .platform-bluesky {
    --native-fg: light-dark(#101827, #f2f2f2);
    --native-muted: light-dark(#68788a, #9aa8b8);
    --native-border: light-dark(#e5eaf0, #273344);
    --native-bg: light-dark(#fff, #111822);
    --native-surface: light-dark(#fff, #111822);
    --native-soft: light-dark(#f3f5f8, #1c2734);
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
    --native-bg: light-dark(#fff, #191b22);
    --native-surface: light-dark(#fff, #191b22);
    --native-fg: light-dark(#282c37, #f5f5f7);
    --native-muted: light-dark(#606984, #9baec8);
    --native-border: light-dark(#e2e4e9, #393f4f);
    --native-soft: light-dark(#f2f3f6, #333846);
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
    display: flex;
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
    --native-fg: light-dark(#101010, #f2f2f2);
    --native-muted: light-dark(#737373, #999);
    --native-border: light-dark(#e9e9e9, #2d2d2d);
    width: min(100%, 39.5rem);
    border-radius: 1rem;
    --native-bg: light-dark(#fff, #101010);
    --native-surface: light-dark(#fff, #101010);
    --native-soft: light-dark(#f3f3f3, #161616);
  }

  .platform-threads .micro-post {
    grid-template-columns: 2.25rem minmax(0, 1fr);
    gap: 0.75rem;
    padding: 1.5rem 1.5rem 0.35rem;
  }

  .platform-threads :global(.preview-actions) {
    justify-content: flex-start;
    gap: 0.65rem;
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

  /* /dev/null (dev-null.sh), from the site's DESIGN.md and commit card: a
     bordered log column on the cool shell, Geist for prose, Geist Mono for
     the machine output (handles, times, hashes), and a quiet muted row. */
  .platform-devnull {
    --native-bg: light-dark(#f6f7f8, #111112);
    --native-surface: light-dark(#fff, #18181a);
    --native-fg: light-dark(#121417, #ececec);
    --native-muted: light-dark(#5b616b, #a1a1a6);
    --native-border: light-dark(#e1e4e8, #2a2a2d);
    --native-soft: light-dark(#eef0f2, #232326);
    --devnull-mono:
      "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    width: min(100%, 38.75rem);
    font-family: "Geist", ui-sans-serif, system-ui, sans-serif;
    font-feature-settings: "ss01", "cv11";
  }

  .platform-devnull .micro-post {
    grid-template-columns: 2.5rem minmax(0, 1fr);
    gap: 0.75rem;
    padding: 0.75rem 1rem 0 0.75rem;
    background: var(--native-surface);
    border-bottom: 0;
  }

  /* The real row hairline starts beside the graph rail, never across it. */
  .platform-devnull .post-column {
    padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--native-border);
  }

  .platform-devnull .micro-post:last-child .post-column {
    border-bottom: 0;
  }

  .platform-devnull .name-line {
    gap: 0.375rem;
    font-size: 0.9375rem;
  }

  .platform-devnull .name-line strong {
    font-weight: 600;
  }

  .platform-devnull .name-line span {
    font-family: var(--devnull-mono);
    font-size: 0.8125rem;
  }

  .platform-devnull .commit-hash {
    flex: 0 0 auto;
    align-self: center;
    color: var(--native-muted);
    font-family: var(--devnull-mono);
    font-size: 0.8125rem;
  }

  .platform-devnull .post-text {
    margin: 0.25rem 0 0.15rem;
    font-size: 0.9375rem;
    line-height: 1.625;
  }

  .platform-devnull .thread-line {
    background: light-dark(#d3d7dd, #36363a);
  }

  /* The real action row: small muted 13px buttons with a 16px icon that pick
     up the hover wash and ink. */
  .platform-devnull :global(.preview-actions) {
    justify-content: flex-start;
    gap: 0.125rem;
    margin-left: -0.5rem;
  }

  .platform-devnull :global(.preview-actions .action) {
    min-height: 1.75rem;
    gap: 0.25rem;
    border-radius: 0.375rem;
    padding: 0 0.5rem;
    font-size: 0.8125rem;
  }

  .platform-devnull :global(.preview-actions .action:hover) {
    background: var(--native-soft);
    color: var(--native-fg);
  }

  .platform-devnull :global(.preview-actions .icon) {
    width: 1rem;
    height: 1rem;
  }

  .platform-devnull :global(.preview-actions .icon svg) {
    width: 1rem;
    height: 1rem;
    stroke-width: 1.75;
  }

  .compact .micro-post {
    padding-inline: 0.75rem;
  }

  @container (max-width: 32rem) {
    .micro-preview,
    .platform-mastodon,
    .platform-threads {
      border-inline: 0;
      border-radius: 0;
    }

    .micro-post,
    .platform-threads .micro-post {
      padding-inline: 0.75rem;
    }

    .name-line strong,
    .name-line span {
      font-size: 0.84rem;
    }
  }
  @media (pointer: coarse) {
    .content-warning button {
      min-height: 44px;
    }
  }
  .platform-x {
    --native-bg: light-dark(#fff, #000);
    --native-surface: light-dark(#fff, #000);
    --native-fg: light-dark(#0f1419, #f2f2f2);
    --native-muted: light-dark(#536471, #8b9095);
    --native-border: light-dark(#eff3f4, #2f3336);
    --native-soft: light-dark(#f3f4f6, #16181c);
  }
</style>
