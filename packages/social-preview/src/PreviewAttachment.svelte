<script lang="ts">
  import Link2 from "@lucide/svelte/icons/link-2";
  import type { PreviewCard, PreviewPlatformKey } from "./model";
  import PreviewAvatar from "./PreviewAvatar.svelte";
  import VerifiedBadge from "./VerifiedBadge.svelte";

  interface Props {
    card: PreviewCard;
    platform: PreviewPlatformKey;
  }

  let { card, platform }: Props = $props();
</script>

<div
  class={["preview-attachment", `platform-${platform}`, `kind-${card.kind}`]}
>
  {#if card.kind === "quote"}
    <div class="quote-header">
      {#if card.author}
        <PreviewAvatar identity={card.author} size={22} />
        <strong>{card.author.displayName}</strong>
        {#if card.author.verified}<VerifiedBadge {platform} />{/if}
        <span>@{card.author.handle.replace(/^@/u, "")}</span>
      {:else}
        <Link2 aria-hidden="true" />
        <strong>Quoted post</strong>
      {/if}
    </div>
    <p>{card.title}</p>
    {#if card.description}<span>{card.description}</span>{/if}
  {:else}
    {#if card.imageUrl}<img src={card.imageUrl} alt="" />{/if}
    <div class="link-copy">
      {#if card.domain}<span>{card.domain}</span>{/if}
      <strong>{card.title}</strong>
      {#if card.description}<p>{card.description}</p>{/if}
    </div>
  {/if}
</div>

<style>
  .preview-attachment {
    overflow: hidden;
    margin-top: 0.75rem;
    border: 1px solid var(--native-border, #cfd9de);
    border-radius: 1rem;
    background: var(--native-surface, #fff);
    color: var(--native-fg, #0f1419);
  }

  .preview-attachment:not(.kind-quote) {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

  .preview-attachment:not(.kind-quote):has(> img) {
    grid-template-columns: minmax(7.5rem, 34%) minmax(0, 1fr);
  }

  .preview-attachment > img {
    width: 100%;
    height: 100%;
    min-height: 7.5rem;
    object-fit: cover;
  }

  .link-copy {
    display: grid;
    align-content: center;
    gap: 0.16rem;
    min-width: 0;
    padding: 0.75rem 0.9rem;
  }

  .link-copy > span,
  .link-copy > p {
    margin: 0;
    color: var(--native-muted, #536471);
    font-size: 0.78rem;
    line-height: 1.35;
  }

  .link-copy > strong {
    overflow: hidden;
    font-size: 0.9rem;
    line-height: 1.35;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .kind-quote {
    display: grid;
    gap: 0.35rem;
    padding: 0.75rem;
  }

  .quote-header {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.8rem;
  }

  .quote-header :global(svg) {
    width: 1rem;
    height: 1rem;
  }

  .quote-header span {
    overflow: hidden;
    color: var(--native-muted, #536471);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .kind-quote > p {
    margin: 0;
    font-size: 0.88rem;
    line-height: 1.4;
    white-space: pre-wrap;
  }

  .kind-quote > span {
    color: var(--native-muted, #536471);
    font-size: 0.76rem;
  }

  .platform-linkedin,
  .platform-facebook {
    border-radius: 0;
  }

  .platform-linkedin:not(.kind-quote) {
    border-inline: 0;
  }

  .platform-mastodon {
    border-color: var(--native-border, #393f4f);
    border-radius: 0.5rem;
  }

  .platform-bluesky {
    border-radius: 0.75rem;
  }

  .platform-discord {
    width: min(100%, 32rem);
    border: 0;
    border-left: 4px solid #5865f2;
    border-radius: 0.25rem;
    background: #2b2d31;
    color: #f2f3f5;
  }

  .platform-discord .link-copy > span,
  .platform-discord .link-copy > p {
    color: #b5bac1;
  }
</style>
