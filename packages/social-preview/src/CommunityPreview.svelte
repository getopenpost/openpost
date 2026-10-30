<script lang="ts">
  import { previewEditing } from "./editing";
  import MoreHorizontal from "@lucide/svelte/icons/ellipsis";
  import type { PreviewModel, PreviewPlatform } from "./model";
  import PreviewActions from "./PreviewActions.svelte";
  import PreviewAttachment from "./PreviewAttachment.svelte";
  import PreviewAvatar from "./PreviewAvatar.svelte";
  import PreviewMedia from "./PreviewMedia.svelte";

  const editing = previewEditing();

  interface Props {
    model: PreviewModel;
    platform: Extract<PreviewPlatform, "lemmy" | "piefed" | "reddit">;
    compact?: boolean;
  }

  let { model, platform, compact = false }: Props = $props();
  const primary = $derived(model.segments[0] ?? { id: "primary", text: "" });
  const media = $derived(primary.media ?? model.media);
  const title = $derived(model.title || primary.text || "Untitled post");
  const body = $derived(model.title ? primary.text : "");
  const communityLabel = $derived.by(() => {
    const raw = model.subtitle?.trim();
    if (!raw) return "";
    const bare = raw.replace(/^[r!]?\/?/u, "");
    if (platform === "reddit") return `r/${bare}`;
    if (platform === "lemmy" || platform === "piefed") return `!${bare}`;
    return raw;
  });
  const authorLabel = $derived(
    platform === "reddit"
      ? `u/${model.identity.displayName.replace(/^u?\//u, "")}`
      : model.identity.displayName,
  );
</script>

<article
  class={["community-preview", `platform-${platform}`, compact && "compact"]}
>
  {#if platform === "reddit"}
    <header>
      <PreviewAvatar identity={model.identity} size={32} />
      <div class="community-meta">
        {#if communityLabel}
          <strong class="community-name">{communityLabel}</strong>
        {/if}
        <span class="author-line">
          {authorLabel} · {model.createdAtLabel}
        </span>
      </div>
      <span class="header-more" aria-hidden="true"
        ><MoreHorizontal /></span
      >
    </header>
  {:else if platform === "lemmy"}
    <!-- Lemmy: one small created line with the community, creator, and the
         published time pushed to the right end of the row. -->
    <header class="created-line">
      <PreviewAvatar identity={model.identity} size={21} />
      {#if communityLabel}
        <span class="community-name" dir="auto">{communityLabel}</span>
      {/if}
      <span class="created-by">by</span>
      <bdi class="author-name">{authorLabel}</bdi>
      <span class="published-time">{model.createdAtLabel}</span>
    </header>
  {/if}

  <h2 dir="auto">{#if editing()?.title}{@render editing()!.title!(title, primary)}{:else}{title}{/if}</h2>

  {#if platform === "piefed"}
    <!-- PieFed: the title comes first, then the small author line with the
         community, creator, and inline published time. -->
    <div class="created-line">
      <PreviewAvatar identity={model.identity} size={20} />
      {#if communityLabel}
        <span class="community-name" dir="auto">{communityLabel}</span>
      {/if}
      <span class="created-by">by</span>
      <bdi class="author-name">{authorLabel}</bdi>
      <span class="published-time">{model.createdAtLabel}</span>
    </div>
  {/if}

  {#if editing()?.text}<div class="post-body">{@render editing()!.text(primary)}</div>{:else if body}<p class="post-body" dir="auto">{body}</p>{/if}
  {#if model.card}
    <PreviewAttachment segment={primary} card={model.card} {platform} />
  {/if}
  {#if media.length > 0}
    <PreviewMedia
      {media}
      layout={platform === "reddit" && media.length > 1 ? "carousel" : "single"}
    />
  {/if}

  <PreviewActions {platform} {compact} />
</article>

<style>
  .community-preview {
    --native-bg: light-dark(#fff, #0b1416);
    --native-surface: light-dark(#f6f7f8, #1a282d);
    --native-fg: light-dark(#1a1a1b, #eef1f3);
    --native-muted: light-dark(#596469, #a8b5bc);
    --native-border: light-dark(#e5e5e6, #34464d);
    width: min(100%, 40rem);
    overflow: hidden;
    border: 1px solid var(--native-border);
    border-radius: 0.5rem;
    background: var(--native-bg);
    color: var(--native-fg);
    font-family:
      -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial,
      sans-serif;
  }

  .community-preview header {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.75rem 1rem 0;
  }

  .community-meta {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }

  .community-name {
    overflow: hidden;
    font-size: 0.8rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .author-line {
    color: var(--native-muted);
    font-size: 0.75rem;
  }

  .community-preview h2 {
    margin: 0;
    padding: 0.6rem 1rem 0;
    overflow-wrap: anywhere;
    font-size: 1.05rem;
    line-height: 1.35;
  }

  .post-body {
    margin: 0;
    padding: 0.5rem 1rem 0;
    font-size: 0.9rem;
    line-height: 1.5;
    white-space: pre-wrap;
    unicode-bidi: plaintext;
    text-align: start;
    overflow-wrap: anywhere;
  }

  .community-preview :global(.preview-actions) {
    border-top: 1px solid var(--native-border);
    margin-top: 0.75rem;
  }
  .header-more {
    display: grid;
    margin-left: auto;
    place-items: center;
    color: var(--native-muted);
  }
  .header-more :global(svg) {
    width: 1.2rem;
    height: 1.2rem;
  }
  .platform-reddit {
    --native-bg: light-dark(#fff, #1a1a1b);
    --native-surface: light-dark(#fff, #1a1a1b);
    --native-fg: light-dark(#1a1a1b, #d7dadc);
    --native-muted: light-dark(#7c7c7c, #818384);
    --native-border: light-dark(#edeff1, #343536);
    --native-soft: light-dark(#f2f2f2, #272729);
    border: 1px solid var(--native-border);
    border-radius: 1rem;
    background: var(--native-bg);
    padding: 0.4rem 0.85rem 0.5rem;
    font-family:
      "IBM Plex Sans",
      -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      Roboto,
      sans-serif;
  }
  .community-preview.platform-reddit header,
  .community-preview.platform-reddit h2,
  .community-preview.platform-reddit .post-body {
    padding-inline: 0;
  }
  .platform-reddit h2 {
    font-size: 1.1rem;
    font-weight: 650;
  }
  .platform-reddit .community-name {
    color: var(--native-fg);
    font-size: 0.78rem;
  }
  .platform-reddit .author-line {
    font-size: 0.72rem;
  }
  .platform-reddit :global(.preview-actions) {
    justify-content: flex-start;
    gap: 0.6rem;
    padding: 0.35rem 0 0.3rem;
    border-top: 0;
  }
  .platform-reddit :global(.media-carousel),
  .platform-reddit :global(.single-media) {
    margin-top: 0.75rem;
    border-radius: 0.75rem;
  }

  /* Shared created-line for lemmy and piefed: one small text row with the
     community avatar inline, matching their feed cards. */
  .community-preview .created-line {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.875rem;
    line-height: 1.4;
  }
  .community-preview .created-line .community-name {
    min-width: 0;
    color: var(--native-link);
    font-size: 0.875rem;
  }
  .community-preview .created-line .created-by {
    color: var(--native-muted);
  }
  .community-preview .created-line .author-name {
    color: var(--native-link);
  }
  .community-preview .published-time {
    flex: 0 0 auto;
    color: var(--native-muted);
  }

  /* Lemmy (litely light / darkly dark tokens): muted teal-gray text, subtle
     borders, rounded small control buttons. */
  .platform-lemmy {
    --native-bg: light-dark(#fff, #222);
    --native-surface: light-dark(#f8f9fa, #2b3035);
    --native-fg: light-dark(#495057, #dee2e6);
    --native-muted: light-dark(rgba(73, 80, 87, 75%), rgba(222, 226, 230, 75%));
    --native-border: light-dark(rgba(73, 80, 87, 25%), rgba(222, 226, 230, 25%));
    --native-link: light-dark(#007bff, #879cb2);
    --native-control: light-dark(#e9ecef, #444);
    border-radius: light-dark(0.5rem, 0.375rem);
    font-family:
      -apple-system, BlinkMacSystemFont, "Droid Sans", "Segoe UI", Verdana,
      "Arimo", Helvetica, Arial, sans-serif;
  }
  .community-preview.platform-lemmy header {
    padding: 0.75rem 1rem 0.25rem;
  }
  /* Lemmy community icons are small rounded squares, not circles. */
  .community-preview.platform-lemmy header :global(.preview-avatar) {
    border-radius: 0.25em;
  }
  .platform-lemmy .published-time {
    margin-left: auto;
    white-space: nowrap;
  }
  .community-preview.platform-lemmy h2 {
    padding: 0.25rem 1rem 0;
    font-size: 1.25rem;
    font-weight: 500;
    line-height: 1.25;
    color: var(--native-fg);
  }
  .community-preview.platform-lemmy .post-body {
    padding: 0.5rem 1rem 0;
    font-size: 1rem;
    line-height: 1.5;
  }
  .platform-lemmy :global(.single-media),
  .platform-lemmy :global(.media-carousel) {
    margin: 0.5rem 1rem 0;
  }
  /* Lemmy action row: left-aligned bordered btn-sm controls in muted colors,
     with the votes as one joined button group. */
  .community-preview.platform-lemmy :global(.preview-actions) {
    gap: 0.75rem;
    margin-top: 0.5rem;
    padding: 0.25rem 1rem 0.6rem;
    border-top: 0;
    color: var(--native-muted);
  }
  .community-preview.platform-lemmy :global(.preview-actions .action) {
    min-height: 1.9rem;
    gap: 0.3rem;
    padding: 0.15rem 0.55rem;
    border: 1px solid var(--native-control);
    border-radius: light-dark(1rem, 0.25rem);
    color: var(--native-muted);
    font-size: 0.8125rem;
    font-weight: 400;
  }
  .community-preview.platform-lemmy :global(.preview-actions .icon) {
    width: auto;
    height: auto;
  }
  .community-preview.platform-lemmy :global(.preview-actions .icon svg) {
    width: 0.95rem;
    height: 0.95rem;
    stroke-width: 2;
  }
  .community-preview.platform-lemmy :global(.preview-actions .count) {
    color: var(--native-muted);
    font-size: 0.8125rem;
    font-weight: 400;
    line-height: 1;
  }
  .community-preview.platform-lemmy :global(.preview-actions .vote-pill) {
    overflow: hidden;
    padding: 0;
    border: 1px solid var(--native-control);
    border-radius: light-dark(1rem, 0.25rem);
  }
  .community-preview.platform-lemmy :global(.preview-actions .vote-pill .action) {
    padding: 0.15rem 0.45rem;
    border: 0;
    border-radius: 0;
  }
  .community-preview.platform-lemmy :global(.preview-actions .vote-pill > :not(:first-child)) {
    border-left: 1px solid var(--native-control);
  }
  .community-preview.platform-lemmy :global(.preview-actions .vote-pill .count) {
    padding-inline: 0.45rem;
  }
  .community-preview.platform-lemmy :global(.preview-actions .vote-pill .action:first-child:hover) {
    color: var(--native-link);
  }
  .community-preview.platform-lemmy :global(.preview-actions .vote-pill .action:last-child:hover) {
    color: light-dark(#d8486a, #e74c3c);
  }

  /* PieFed: Bootstrap body, blue links, green upvote accent, title above the
     author line, and roomy 44px utility controls. */
  .platform-piefed {
    --native-bg: light-dark(#fff, #212529);
    --native-surface: light-dark(#f8f9fa, #2b3035);
    --native-fg: light-dark(#212529, #dee2e6);
    --native-muted: light-dark(rgba(33, 37, 41, 75%), rgba(222, 226, 230, 75%));
    --native-border: light-dark(#ddd, #495057);
    --native-link: light-dark(#0d6efd, #6ea8fe);
    border-radius: 0.375rem;
    font-family:
      system-ui, -apple-system, "Inter", Roboto, "Helvetica Neue", "Noto Sans",
      "Liberation Sans", Arial, sans-serif;
  }
  .platform-piefed .created-line {
    flex-wrap: wrap;
    padding: 0.1rem 1rem 0.35rem;
  }
  .platform-piefed .published-time {
    color: var(--native-fg);
    white-space: nowrap;
  }
  .community-preview.platform-piefed h2 {
    padding: 0.75rem 1rem 0.15rem;
    font-size: 1.06rem;
    font-weight: 500;
    line-height: 1.3;
    color: var(--native-link);
  }
  .community-preview.platform-piefed .post-body {
    padding: 0.25rem 1rem 0;
    font-size: 0.875rem;
    line-height: 1.5;
  }
  .community-preview.platform-piefed :global(.preview-actions) {
    gap: 0.75rem;
    min-height: 2.75rem;
    margin-top: 0.35rem;
    padding: 0.15rem 0.9rem 0.3rem;
    border-top: 0;
  }
  .community-preview.platform-piefed :global(.preview-actions .action) {
    min-width: 2.75rem;
    min-height: 2.4rem;
    gap: 0.25rem;
    color: var(--native-link);
    font-size: 0.82rem;
    font-weight: 400;
  }
  .community-preview.platform-piefed :global(.preview-actions .icon) {
    width: auto;
    height: auto;
  }
  .community-preview.platform-piefed :global(.preview-actions .icon svg) {
    width: 1.1rem;
    height: 1.1rem;
    stroke-width: 2;
  }
  .community-preview.platform-piefed :global(.preview-actions .action .count) {
    color: var(--native-link);
    font-size: 0.82rem;
    font-weight: 400;
    line-height: 1;
  }
  .community-preview.platform-piefed :global(.preview-actions .vote-pill .count) {
    color: var(--native-fg);
    font-size: 0.82rem;
    font-weight: 400;
    line-height: 1;
  }
  .community-preview.platform-piefed :global(.preview-actions .vote-pill .action:first-child:hover) {
    color: #008000;
  }
  .community-preview.platform-piefed :global(.preview-actions .vote-pill .action:last-child:hover) {
    color: rgba(251, 74, 74, 84.6%);
  }
  .community-preview.platform-piefed :global(.preview-actions .action[title="More"]) {
    margin-left: auto;
    color: var(--native-muted);
  }
  .compact header,
  .compact h2,
  .compact .post-body,
  .compact .created-line {
    padding-inline: 0.75rem;
  }
  /* The lemmy/piefed rules above carry higher specificity, so compact mode
     restates its tighter inline padding for their padded elements. */
  .compact.platform-lemmy header,
  .compact.platform-lemmy h2,
  .compact.platform-lemmy .post-body,
  .compact.platform-lemmy :global(.single-media),
  .compact.platform-lemmy :global(.media-carousel),
  .compact.platform-lemmy :global(.preview-actions),
  .compact.platform-piefed h2,
  .compact.platform-piefed .post-body,
  .compact.platform-piefed .created-line,
  .compact.platform-piefed :global(.preview-actions) {
    padding-inline: 0.75rem;
  }
</style>
