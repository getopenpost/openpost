<script lang="ts">
  import BarChart3 from "@lucide/svelte/icons/chart-no-axes-column-increasing";
  import Bookmark from "@lucide/svelte/icons/bookmark";
  import Download from "@lucide/svelte/icons/download";
  import Heart from "@lucide/svelte/icons/heart";
  import MessageCircle from "@lucide/svelte/icons/message-circle";
  import MoreHorizontal from "@lucide/svelte/icons/ellipsis";
  import Repeat2 from "@lucide/svelte/icons/repeat-2";
  import Send from "@lucide/svelte/icons/send";
  import Share2 from "@lucide/svelte/icons/share-2";
  import Star from "@lucide/svelte/icons/star";
  import ThumbsDown from "@lucide/svelte/icons/thumbs-down";
  import ThumbsUp from "@lucide/svelte/icons/thumbs-up";
  import Upload from "@lucide/svelte/icons/upload";
  import type { PreviewPlatformKey } from "./model";

  type ActionName =
    | "reply"
    | "repost"
    | "like"
    | "favorite"
    | "views"
    | "bookmark"
    | "share"
    | "send"
    | "comment"
    | "download"
    | "dislike"
    | "more";

  interface Action {
    name: ActionName;
    label: string;
  }

  interface Props {
    platform: PreviewPlatformKey;
    vertical?: boolean;
    compact?: boolean;
  }

  let { platform, vertical = false, compact = false }: Props = $props();

  const actions = $derived.by<Action[]>(() => {
    switch (platform) {
      case "x":
        return [
          { name: "reply", label: "Reply" },
          { name: "repost", label: "Repost" },
          { name: "like", label: "Like" },
          { name: "views", label: "Views" },
          { name: "bookmark", label: "Bookmark" },
          { name: "share", label: "Share" },
        ];
      case "mastodon":
        return [
          { name: "reply", label: "Reply" },
          { name: "repost", label: "Boost" },
          { name: "favorite", label: "Favorite" },
          { name: "bookmark", label: "Bookmark" },
          { name: "more", label: "More" },
        ];
      case "bluesky":
        return [
          { name: "reply", label: "Reply" },
          { name: "repost", label: "Repost" },
          { name: "like", label: "Like" },
          { name: "more", label: "More" },
        ];
      case "linkedin":
        return [
          { name: "like", label: "Like" },
          { name: "comment", label: "Comment" },
          { name: "repost", label: "Repost" },
          { name: "send", label: "Send" },
        ];
      case "threads":
        return [
          { name: "like", label: "Like" },
          { name: "reply", label: "Reply" },
          { name: "repost", label: "Repost" },
          { name: "send", label: "Share" },
        ];
      case "instagram":
        return [
          { name: "like", label: "Like" },
          { name: "comment", label: "Comment" },
          { name: "send", label: "Share" },
          { name: "bookmark", label: "Save" },
        ];
      case "facebook":
        return [
          { name: "like", label: "Like" },
          { name: "comment", label: "Comment" },
          { name: "share", label: "Share" },
        ];
      case "youtube":
        return [
          { name: "like", label: "Like" },
          { name: "dislike", label: "Dislike" },
          { name: "share", label: "Share" },
          { name: "download", label: "Download" },
          { name: "bookmark", label: "Save" },
          { name: "more", label: "More" },
        ];
      case "tiktok":
        return [
          { name: "like", label: "Like" },
          { name: "comment", label: "Comment" },
          { name: "bookmark", label: "Save" },
          { name: "share", label: "Share" },
        ];
      case "discord":
        return [
          { name: "like", label: "Add reaction" },
          { name: "reply", label: "Reply" },
          { name: "more", label: "More" },
        ];
      default:
        return [];
    }
  });

  const showText = $derived(
    !compact &&
      !vertical &&
      (platform === "linkedin" ||
        platform === "facebook" ||
        platform === "youtube"),
  );
</script>

{#snippet icon(name: ActionName)}
  {#if name === "reply" || name === "comment"}
    <MessageCircle />
  {:else if name === "repost"}
    <Repeat2 />
  {:else if name === "like"}
    {#if platform === "linkedin" || platform === "facebook" || platform === "youtube"}
      <ThumbsUp />
    {:else}
      <Heart />
    {/if}
  {:else if name === "favorite"}
    <Star />
  {:else if name === "views"}
    <BarChart3 />
  {:else if name === "bookmark"}
    <Bookmark />
  {:else if name === "send"}
    <Send />
  {:else if name === "share"}
    {#if platform === "x"}
      <Upload />
    {:else}
      <Share2 />
    {/if}
  {:else if name === "download"}
    <Download />
  {:else if name === "dislike"}
    <ThumbsDown />
  {:else}
    <MoreHorizontal />
  {/if}
{/snippet}

<div
  class={[
    "preview-actions",
    `platform-${platform}`,
    vertical && "vertical-actions",
    showText && "with-labels",
  ]}
  aria-label="Post actions"
>
  {#each actions as action (action.name)}
    <span class="action" title={action.label}>
      <span class="icon" aria-hidden="true">{@render icon(action.name)}</span>
      {#if vertical}
        <small>0</small>
      {:else if showText}
        <span>{action.label}</span>
      {:else}
        <span class="sr-only">{action.label}</span>
      {/if}
    </span>
  {/each}
</div>

<style>
  .preview-actions {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: 0.35rem;
    color: var(--native-muted, #536471);
  }

  .action {
    display: inline-flex;
    min-width: 0;
    min-height: 2.5rem;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    font-size: 0.78rem;
    font-weight: 600;
  }

  .icon {
    display: grid;
    width: 2rem;
    height: 2rem;
    place-items: center;
    border-radius: 50%;
  }

  .icon :global(svg) {
    width: 1.22rem;
    height: 1.22rem;
    stroke-width: 1.85;
  }

  .platform-x .icon :global(svg) {
    width: 1.15rem;
    height: 1.15rem;
  }

  .platform-instagram,
  .platform-threads {
    color: var(--native-fg, #0f1419);
  }

  .platform-instagram .icon :global(svg),
  .platform-threads .icon :global(svg) {
    width: 1.48rem;
    height: 1.48rem;
    stroke-width: 1.8;
  }

  .platform-mastodon .icon :global(svg) {
    fill: transparent;
    stroke-width: 2;
  }

  .with-labels {
    color: var(--native-muted, #666);
  }

  .with-labels .action {
    flex: 1 1 0;
    padding-inline: 0.35rem;
  }

  .platform-youtube.with-labels {
    justify-content: flex-start;
    gap: 0.5rem;
    color: var(--native-fg, #0f0f0f);
  }

  .platform-youtube.with-labels .action {
    flex: 0 0 auto;
    min-height: 2.25rem;
    border-radius: 999px;
    background: var(--native-soft, #f2f2f2);
    padding: 0 0.75rem 0 0.35rem;
  }

  .vertical-actions {
    display: grid;
    justify-items: center;
    gap: 0.7rem;
    color: white;
    filter: drop-shadow(0 1px 1px rgb(0 0 0 / 55%));
  }

  .vertical-actions .action {
    display: grid;
    min-height: auto;
    justify-items: center;
    gap: 0.1rem;
  }

  .vertical-actions .icon {
    width: 2.75rem;
    height: 2.75rem;
    background: rgb(20 20 20 / 32%);
  }

  .vertical-actions .icon :global(svg) {
    width: 1.65rem;
    height: 1.65rem;
  }

  .vertical-actions small {
    font-size: 0.68rem;
    font-weight: 700;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  @media (max-width: 32rem) {
    .with-labels .action {
      gap: 0.3rem;
      font-size: 0.7rem;
    }

    .platform-youtube.with-labels .action:nth-child(n + 5) {
      display: none;
    }
  }
</style>
