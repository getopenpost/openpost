<script lang="ts">
  import { previewEditing } from "./editing";
  import MoreHorizontal from "@lucide/svelte/icons/ellipsis";
  import MoreVertical from "@lucide/svelte/icons/ellipsis-vertical";
  import type { PreviewModel } from "./model";
  import PreviewActions from "./PreviewActions.svelte";
  import PreviewPoll from "./PreviewPoll.svelte";
  import PreviewAttachment from "./PreviewAttachment.svelte";
  import PreviewAvatar from "./PreviewAvatar.svelte";
  import PreviewMedia from "./PreviewMedia.svelte";
  import VerifiedBadge from "./VerifiedBadge.svelte";
  import VerticalPreview from "./VerticalPreview.svelte";
  import PreviewText from "./PreviewText.svelte";

  const editing = previewEditing();

  interface Props {
    model: PreviewModel;
    compact?: boolean;
    platform?: "instagram" | "pixelfed";
  }

  let { model, compact = false, platform = "instagram" }: Props = $props();
  let revealedWarning = $state<string | null>(null);
  const primary = $derived(model.segments[0] ?? { id: "primary", text: "" });
  const warning = $derived(primary.contentWarning ?? model.contentWarning);
  const warningHidden = $derived(
    Boolean(warning && revealedWarning !== warning),
  );
  const media = $derived(primary.media ?? model.media);
  const handle = $derived(model.identity.handle.replace(/^@/u, ""));
  const isVertical = $derived(
    model.format === "story" || model.format === "reel",
  );
</script>

{#if isVertical}
  <VerticalPreview {model} platform="instagram" {compact} />
{:else}
  <article
    class={["instagram-preview", `platform-${platform}`, compact && "compact"]}
  >
    <header>
      <PreviewAvatar identity={model.identity} size={platform === "pixelfed" ? 44 : 32} ring={platform === "instagram"} />
      <div class="identity">
        <div>
          <strong>{handle}</strong>
          {#if model.identity.verified}<VerifiedBadge {platform} />{/if}
        </div>
        {#if platform === "pixelfed"}
          <span class="identity-meta">{model.createdAtLabel}{#if model.location} · {model.location}{/if}</span>
        {:else if model.location}
          <span>{model.location}</span>
        {/if}
      </div>
      {#if platform === "pixelfed"}<MoreVertical aria-hidden="true" />{:else}<MoreHorizontal aria-hidden="true" />{/if}
    </header>

    {#if warning}
      <div class="content-warning">
        <strong>{warning}</strong><span>Content warning</span><button
          type="button"
          aria-expanded={!warningHidden}
          onclick={() =>
            (revealedWarning = warningHidden ? (warning ?? null) : null)}
          >{warningHidden ? "Show more" : "Hide"}</button
        >
      </div>
    {/if}
    {#if !warningHidden}
      {#if media.length > 0}
        <PreviewMedia {media} segment={primary} layout="carousel" />
      {:else}
        <div class="empty-feed-media">
          <span aria-hidden="true">▧</span>
          <p>Add a photo or video to preview this post.</p>
        </div>
      {/if}

      {#snippet actionsRow()}
        <div class="post-actions">
          <PreviewActions {platform} {compact} />
        </div>
      {/snippet}
      {#snippet captionRow()}
        <div class="caption">
          <div class="caption-text">
            {#if editing()?.text}{@render editing()!.text(primary)}{:else}
            <PreviewText
              text={primary.text}
              author={platform === "pixelfed" ? undefined : handle}
              lines={2}
              buttonLabel="more"
            />
            {/if}
          </div>
          {#if platform === "pixelfed" && model.card}<PreviewAttachment segment={primary}
              card={model.card}
              {platform}
            />{/if}
          {#if platform === "pixelfed" && model.poll}<PreviewPoll segment={primary}
              poll={model.poll}
              {platform}
            />{/if}
          {#if platform !== "pixelfed"}<small>{model.createdAtLabel}</small>{/if}
        </div>
      {/snippet}
      {#if platform === "pixelfed"}
        {@render captionRow()}
        {@render actionsRow()}
      {:else}
        {@render actionsRow()}
        {@render captionRow()}
      {/if}
    {/if}
  </article>
{/if}

<style>
  .instagram-preview {
    --native-bg: light-dark(#fff, #0c1014);
    --native-surface: light-dark(#fff, #0c1014);
    --native-fg: light-dark(#000, #f5f5f5);
    --native-muted: light-dark(#737373, #a8a8a8);
    --native-border: light-dark(#dbdbdb, #262626);
    width: min(100%, 29.375rem);
    overflow: hidden;
    border: 1px solid var(--native-border);
    border-radius: 0.25rem;
    background: var(--native-bg);
    color: var(--native-fg);
    font-family:
      "Optimistic Text", Optimistic, Montserrat, Helvetica, Arial, "Noto Sans",
      sans-serif;
  }

  .platform-instagram {
    -webkit-font-smoothing: antialiased;
  }

  header {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.65rem;
    min-height: 3.75rem;
    padding: 0.55rem 1rem;
  }

  .identity {
    display: grid;
    min-width: 0;
    gap: 0.12rem;
  }

  .identity > div {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.25rem;
  }

  .identity strong {
    overflow: hidden;
    font-size: 0.82rem;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .platform-instagram .identity strong {
    font-size: 0.875rem;
    font-weight: 600;
    line-height: 1.125rem;
  }

  .platform-instagram .identity > span {
    font-size: 0.75rem;
    line-height: 1rem;
  }

  .identity > span {
    font-size: 0.68rem;
  }

  header > :global(svg) {
    width: 1.25rem;
    height: 1.25rem;
  }

  .platform-instagram header > :global(svg) {
    width: 1.5rem;
    height: 1.5rem;
  }

  .empty-feed-media {
    display: grid;
    aspect-ratio: 1;
    place-items: center;
    align-content: center;
    gap: 0.6rem;
    border-block: 1px solid var(--native-border);
    background: light-dark(#f7f7f7, #121212);
    color: var(--native-muted);
    text-align: center;
  }

  .empty-feed-media > span {
    font-size: 2.4rem;
    font-weight: 200;
  }

  .empty-feed-media p {
    max-width: 27ch;
    margin: 0;
    font-size: 0.75rem;
    line-height: 1.4;
  }

  .platform-instagram .empty-feed-media {
    background: light-dark(#efefef, #262626);
  }

  .post-actions {
    padding: 0.15rem 0.55rem 0;
  }

  .platform-instagram .post-actions {
    padding: 0.25rem 1rem 0;
  }

  .platform-instagram .post-actions :global(.icon svg) {
    width: 1.5rem;
    height: 1.5rem;
  }

  .post-actions :global(.preview-actions) {
    justify-content: flex-start;
    gap: 0.1rem;
  }

  .post-actions :global(.action:last-child) {
    margin-left: auto;
  }

  .caption {
    display: grid;
    gap: 0.3rem;
    padding: 0.25rem 1rem 1rem;
  }

  .caption-text {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.125rem;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .platform-instagram .caption-text :global(strong) {
    font-weight: 600;
  }

  .caption small {
    margin-top: 0.2rem;
    color: var(--native-muted);
    font-size: 0.75rem;
    letter-spacing: 0.04em;
    line-height: 1rem;
    text-transform: uppercase;
  }

  .compact header {
    min-height: 3.35rem;
  }

  @container (max-width: 32rem) {
    .instagram-preview {
      border-inline: 0;
      border-radius: 0;
    }
    .instagram-preview.platform-pixelfed {
      border-inline: 1px solid var(--native-border);
      border-radius: 15px;
    }
  }
  .platform-pixelfed {
    --native-bg: light-dark(#fff, #161618);
    --native-surface: light-dark(#fff, #161618);
    --native-fg: light-dark(#212529, #9ca3af);
    --native-muted: light-dark(#94a3b8, #818181);
    --native-border: light-dark(#dee2e6, #212124);
    --native-soft: light-dark(#f8f9fa, #212124);
    width: min(100%, 45rem);
    border-radius: 15px;
    box-shadow: 0 0.125rem 0.25rem rgb(0 0 0 / 7.5%);
    font-family:
      "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      Helvetica, Arial, sans-serif;
  }

  .platform-pixelfed header {
    padding: 0.75rem 1.25rem;
  }

  .platform-pixelfed header :global(.preview-avatar) {
    border-radius: 15px;
  }

  .platform-pixelfed .identity strong {
    font-family:
      -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial,
      sans-serif;
    font-size: 1.0625rem;
  }

  .platform-pixelfed .identity-meta {
    color: var(--native-muted);
    font-size: 0.8125rem;
  }

  .platform-pixelfed .caption {
    padding: 1.25rem 1.25rem 0;
  }

  .platform-pixelfed .caption-text {
    font-size: 1rem;
    line-height: 1.5;
  }

  .platform-pixelfed .post-actions {
    margin-block: 1rem;
    padding-inline: 1rem;
  }

  .platform-pixelfed .post-actions :global(.preview-actions) {
    gap: 0.5rem;
  }

  .platform-pixelfed .post-actions :global(.action) {
    min-height: 2.25rem;
    border-radius: 999px;
    background: var(--native-soft);
    padding-inline: 0.9rem;
    font-size: 0.875rem;
    font-weight: 700;
  }

  .platform-pixelfed .post-actions :global(.icon) {
    width: 1.5rem;
    height: 1.5rem;
  }

  .platform-pixelfed .post-actions :global(.icon svg) {
    width: 1rem;
    height: 1rem;
  }

  .platform-pixelfed .post-actions :global(.action:nth-last-child(2)) {
    margin-left: auto;
  }

  .platform-pixelfed .post-actions :global(.action:last-child) {
    margin-left: 1rem;
  }
  .content-warning {
    display: grid;
    gap: 0.4rem;
    padding: 1rem;
    font-size: 0.85rem;
    overflow-wrap: anywhere;
  }
  .content-warning > span {
    color: var(--native-muted);
    font-size: 0.75rem;
  }
  .content-warning button {
    justify-self: start;
    min-height: 2.25rem;
    border: 1px solid var(--native-border);
    border-radius: 0.35rem;
    background: var(--native-bg);
    color: var(--native-fg);
    padding: 0.4rem 0.8rem;
    font: inherit;
    cursor: pointer;
  }
  @media (pointer: coarse) {
    .content-warning button {
      min-height: 44px;
    }
  }
</style>
