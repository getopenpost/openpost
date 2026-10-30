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
            ? 40
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

  /* Bluesky web app (social-app): InterVariable with the system stack,
     the ALF default palette (dark is the inverted palette, so pure black),
     a 42px feed avatar, 15px/1.3 post text, and 18px stroke-2 controls at
     contrast_500 with a contrast_25 hover pill. */
  .platform-bluesky {
    --native-fg: light-dark(#000, #fff);
    --native-muted: light-dark(#405168, #a5b2c5);
    --native-border: light-dark(#dce2ea, #232e3e);
    --native-bg: light-dark(#fff, #000);
    --native-surface: light-dark(#fff, #000);
    --native-soft: light-dark(#f9fafb, #111822);
    font-family:
      "InterVariable", Inter, system-ui, -apple-system, BlinkMacSystemFont,
      "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }

  /* Feed item: 10px outer, 8px avatar rail, 18px avatar gutter, 15px right. */
  .platform-bluesky .micro-post {
    grid-template-columns: 2.625rem minmax(0, 1fr);
    gap: 0.625rem;
    padding: 0.55rem 0.9375rem 0.5rem 1.125rem;
  }

  /* The real feed washes the whole item with contrast_50 on hover. */
  .platform-bluesky .micro-post:hover {
    background: light-dark(rgb(239 242 246 / 50%), rgb(25 34 46 / 40%));
  }

  .platform-bluesky .name-line {
    font-size: 0.9375rem;
    line-height: 1.15;
  }

  .platform-bluesky .name-line strong {
    font-weight: 600;
  }

  /* The real post menu lives in the action row, not the author row. */
  .platform-bluesky :global(.more) {
    display: none;
  }

  .platform-bluesky .thread-line {
    top: 2.875rem;
  }

  .platform-bluesky .post-text {
    margin: 0.625rem 0 0.25rem;
    font-size: 0.9375rem;
    line-height: 1.3;
  }

  .platform-bluesky :global(.media-grid) {
    border-radius: 0.75rem;
  }

  /* Content hider: contrast_25 wash, rounded_sm, 13px semibold label with a
     plain contrast_high Show/Hide toggle. */
  .platform-bluesky .content-warning {
    margin: 0.25rem 0 0.5rem;
    border-radius: 0.5rem;
    background: var(--native-soft);
    padding: 0.75rem 1rem;
  }

  .platform-bluesky .content-warning:hover {
    background: light-dark(#eff2f6, #19222e);
  }

  .platform-bluesky .content-warning strong {
    color: var(--native-muted);
    font-size: 0.8125rem;
    font-weight: 600;
  }

  .platform-bluesky .content-warning span {
    font-size: 0.72rem;
  }

  .platform-bluesky .content-warning button {
    min-height: 1.75rem;
    border-radius: 0.375rem;
    background: transparent;
    color: light-dark(#232e3e, #dce2ea);
    font-size: 0.8125rem;
    font-weight: 600;
  }

  /* Controls: justify-between row, 12px gaps, 18px icons, hover pill. */
  .platform-bluesky :global(.preview-actions) {
    gap: 0.75rem;
    margin-top: 0.125rem;
    color: #667b99;
  }

  .platform-bluesky :global(.preview-actions .action) {
    min-height: 1.75rem;
    gap: 0.25rem;
    border-radius: 999px;
    padding: 0 0.3125rem;
    font-size: 0.8125rem;
  }

  .platform-bluesky :global(.preview-actions .action:hover) {
    background: var(--native-soft);
  }

  .platform-bluesky :global(.preview-actions .icon) {
    width: auto;
    height: auto;
  }

  .platform-bluesky :global(.preview-actions .icon svg) {
    width: 1.125rem;
    height: 1.125rem;
    stroke-width: 2;
  }

  /* Mastodon web UI: Inter body text and the flavor token system with the
     default indigo flavor: light #fff surfaces on #21212c text with #705dd6
     accents, dark #15151e surfaces on #eeedf3 text with #d1c7ff accents, and
     borders/washes as accent-alpha. Feed rows use a 40px avatar, a 48px
     first column, 12/16/8px padding, 15px/1.46 text, and 20px icons in
     32px pill buttons whose active group splits left and right. */
  .platform-mastodon {
    --native-bg: light-dark(#fff, #15151e);
    --native-surface: light-dark(#fff, #15151e);
    --native-fg: light-dark(#21212c, #eeedf3);
    --native-muted: light-dark(rgb(33 33 44 / 80%), rgb(238 237 243 / 80%));
    --native-border: light-dark(rgb(112 93 214 / 20%), rgb(209 199 255 / 20%));
    --native-soft: light-dark(rgb(112 93 214 / 8%), rgb(209 199 255 / 8%));
    width: min(100%, 43.75rem);
    border-radius: 0.75rem;
    font-family:
      Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
      sans-serif;
  }

  .platform-mastodon .micro-post {
    grid-template-columns: 2.5rem minmax(0, 1fr);
    gap: 0.5rem;
    padding: 0.75rem 1rem 0.5rem;
  }

  /* Feed rows separate with the 0.5px hairline border. */
  .platform-mastodon .micro-post:not(:last-child) {
    border-bottom: 0.5px solid var(--native-border);
  }

  .platform-mastodon header {
    align-items: center;
    padding-bottom: 0.5rem;
  }

  .platform-mastodon .name-line {
    display: flex;
    font-size: 0.9375rem;
    line-height: 1.46;
  }

  .platform-mastodon .mastodon-handle {
    display: block;
    margin-top: 0.1rem;
    font-size: 0.8125rem;
    letter-spacing: 0.02em;
  }

  .platform-mastodon .post-time {
    font-size: 0.9375rem;
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
    margin: 0 0 0.5rem;
    font-size: 0.9375rem;
    line-height: 1.46;
  }

  .platform-mastodon .thread-line {
    top: 2.75rem;
    bottom: -1.15rem;
    background: var(--native-border);
  }

  /* The real gallery clips into radius-4 with 8px content gaps. */
  .platform-mastodon .mastodon-post :global(.media-grid) {
    margin-top: 0.5rem;
    border-radius: 1rem;
  }

  /* Content warning callout: accent-8% wash, radius-3, 14px text, and the
     sm tonal pill toggle. */
  .platform-mastodon .content-warning {
    border-radius: 0.75rem;
    background: var(--native-soft);
    padding: 0.75rem;
  }

  .platform-mastodon .content-warning strong {
    font-size: 0.875rem;
  }

  .platform-mastodon .content-warning span {
    font-size: 0.75rem;
  }

  .platform-mastodon .content-warning button {
    min-height: 2rem;
    background: light-dark(rgb(33 33 44 / 4%), rgb(238 237 243 / 4%));
    color: var(--native-fg);
    padding: 0 0.75rem;
    font-size: 0.875rem;
  }

  .platform-mastodon .content-warning button:hover {
    background: light-dark(rgb(33 33 44 / 10%), rgb(238 237 243 / 10%));
  }

  /* Action bar: left reply/boost/favorite group, right bookmark/more group,
     14px bold counters, 20px icons, 0.7 idle opacity with a hover wash. */
  .platform-mastodon :global(.preview-actions) {
    justify-content: flex-start;
    gap: 0.25rem;
    margin-top: 0.5rem;
    color: var(--native-fg);
  }

  .platform-mastodon :global(.preview-actions .action) {
    min-height: 2rem;
    gap: 0.25rem;
    border-radius: 999px;
    padding: 0 0.5rem;
    font-size: 0.875rem;
    font-weight: 700;
    opacity: 0.7;
  }

  .platform-mastodon :global(.preview-actions .action:hover) {
    opacity: 1;
    background: var(--native-soft);
  }

  .platform-mastodon :global(.preview-actions .action:nth-child(4)) {
    margin-inline-start: auto;
  }

  .platform-mastodon :global(.preview-actions .icon) {
    width: auto;
    height: auto;
  }

  .platform-mastodon :global(.preview-actions .icon svg) {
    width: 1.25rem;
    height: 1.25rem;
  }

  @media (pointer: coarse) {
    .platform-bluesky .content-warning button,
    .platform-mastodon .content-warning button {
      min-height: 44px;
    }
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
