<script lang="ts">
  import { previewEditing } from "./editing";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import BarChart3 from "@lucide/svelte/icons/chart-no-axes-column-increasing";
  import Bookmark from "@lucide/svelte/icons/bookmark";
  import Download from "@lucide/svelte/icons/download";
  import HandHeart from "@lucide/svelte/icons/hand-heart";
  import Heart from "@lucide/svelte/icons/heart";
  import MessageCircle from "@lucide/svelte/icons/message-circle";
  import MoreHorizontal from "@lucide/svelte/icons/ellipsis";
  import Quote from "@lucide/svelte/icons/quote";
  import Repeat2 from "@lucide/svelte/icons/repeat-2";
  import Send from "@lucide/svelte/icons/send";
  import Share2 from "@lucide/svelte/icons/share-2";
  import Star from "@lucide/svelte/icons/star";
  import ThumbsDown from "@lucide/svelte/icons/thumbs-down";
  import ThumbsUp from "@lucide/svelte/icons/thumbs-up";
  import Upload from "@lucide/svelte/icons/upload";
  import type { PreviewPlatformKey } from "./model";

  const editing = previewEditing();

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
    | "support"
    | "quote"
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

  type CommunityPlatform = Extract<
    PreviewPlatformKey,
    "reddit" | "lemmy" | "piefed"
  >;
  const isCommunity = $derived(
    platform === "reddit" || platform === "lemmy" || platform === "piefed",
  );
  const communityPlatform = $derived(
    platform === "reddit"
      ? ("reddit" as CommunityPlatform)
      : platform === "lemmy"
        ? ("lemmy" as CommunityPlatform)
        : ("piefed" as CommunityPlatform),
  );

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
      case "pixelfed":
        return [
          { name: "like", label: "Like" },
          { name: "comment", label: "Comment" },
          { name: "repost", label: "Share" },
          { name: "bookmark", label: "Save" },
        ];
      case "bluesky":
        return [
          { name: "reply", label: "Reply" },
          { name: "repost", label: "Repost" },
          { name: "like", label: "Like" },
          { name: "more", label: "More" },
        ];
      case "devnull":
        return [
          { name: "favorite", label: "Star" },
          { name: "quote", label: "Quote" },
          { name: "reply", label: "Reply" },
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
      case "peertube":
        return [
          { name: "like", label: "Like" },
          { name: "dislike", label: "Dislike" },
          { name: "support", label: "Support" },
          { name: "share", label: "Share" },
          { name: "download", label: "Download" },
          { name: "more", label: "More" },
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
    !vertical &&
      (platform === "facebook" ||
        platform === "youtube" ||
        platform === "peertube"),
  );
</script>

{#snippet icon(name: ActionName)}
  {#if name === "reply" || name === "comment"}
    <MessageCircle />
  {:else if name === "repost"}
    <Repeat2 />
  {:else if name === "like"}
    {#if platform === "linkedin" || platform === "facebook" || platform === "youtube" || platform === "peertube"}
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
  {:else if name === "support"}
    <HandHeart />
  {:else if name === "quote"}
    <Quote />
  {:else if name === "dislike"}
    <ThumbsDown />
  {:else}
    <MoreHorizontal />
  {/if}
{/snippet}

{#snippet communityIcon(name: "up" | "down" | "comment" | "share" | "save" | "more")}
  {#if name === "up"}<ArrowUp />{:else if name === "down"}<ArrowDown
    />{:else if name === "comment"}<MessageCircle />{:else if name === "share"}<Share2
    />{:else if name === "save"}<Bookmark />{:else}<MoreHorizontal />{/if}
{/snippet}

{#snippet communityCommentAction()}
  <span class="action" title="Comments">
    <span class="icon" aria-hidden="true">{@render communityIcon("comment")}</span>
    <strong class="count">0</strong>
    <span class="sr-only">Comments</span>
  </span>
{/snippet}

{#if !editing()}
<div
  class={[
    "preview-actions",
    `platform-${platform}`,
    isCommunity && "community-actions",
    vertical && "vertical-actions",
    showText && "with-labels",
    compact && "compact",
  ]}
  aria-label="Post actions"
>
  {#if isCommunity}
    {#if communityPlatform !== "reddit"}{@render communityCommentAction()}{/if}
    <span class="vote-pill" title="Votes">
      <span class="action" title="Upvote">
        <span class="icon" aria-hidden="true">{@render communityIcon("up")}</span>
        <span class="sr-only">Upvote</span>
      </span>
      <strong class="count score">0</strong>
      <span class="action" title="Downvote">
        <span class="icon" aria-hidden="true">{@render communityIcon("down")}</span>
        <span class="sr-only">Downvote</span>
      </span>
    </span>
    {#if communityPlatform === "reddit"}
      {@render communityCommentAction()}
      <span class="action" title="Share">
        <span class="icon" aria-hidden="true">{@render communityIcon("share")}</span>
        <span class="sr-only">Share</span>
      </span>
      <span class="action" title="Save">
        <span class="icon" aria-hidden="true">{@render communityIcon("save")}</span>
        <span class="sr-only">Save</span>
      </span>
    {/if}
    <span class="action" title="More">
      <span class="icon" aria-hidden="true">{@render communityIcon("more")}</span>
      <span class="sr-only">More</span>
    </span>
  {:else}
    {#each actions as action (action.name)}
      <span class="action" title={action.label}>
        <span class="icon" aria-hidden="true">{@render icon(action.name)}</span>
        {#if vertical}
          <small>{action.label}</small>
        {:else if showText}
          <span>{action.label}</span>
        {:else}
          <span class="sr-only">{action.label}</span>
        {/if}
      </span>
    {/each}
  {/if}
</div>

{/if}

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
  .platform-pixelfed,
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

  @container (max-width: 32rem) {
    .with-labels .action {
      gap: 0.3rem;
      font-size: 0.7rem;
    }

    .platform-youtube.with-labels .action:nth-child(n + 5) {
      display: none;
    }
  }
  @container (max-width: 22rem) {
    .with-labels .action {
      flex-direction: column;
      gap: 0;
      padding: 0;
      font-size: 0.63rem;
    }
    .with-labels .icon {
      height: 1.65rem;
    }
  }
  .platform-reddit {
    color: var(--native-fg);
  }
  .community-actions {
    justify-content: flex-start;
    gap: 0.6rem;
    color: var(--native-muted, #7c7c7c);
  }
  .community-actions .action {
    min-height: 2.25rem;
    gap: 0.3rem;
  }
  .community-actions .icon {
    width: 1.75rem;
    height: 1.75rem;
  }
  .community-actions .icon :global(svg) {
    width: 1.05rem;
    height: 1.05rem;
    stroke-width: 2;
  }
  .community-actions .count {
    color: var(--native-fg, #1a1a1b);
    font-size: 0.78rem;
    font-weight: 700;
    line-height: 1;
  }
  .vote-pill {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    background: var(--native-soft, #f2f2f2);
    padding: 0.1rem 0.2rem;
  }
  .vote-pill .action {
    min-height: 2rem;
  }
  .platform-lemmy .vote-pill,
  .platform-piefed .vote-pill {
    background: transparent;
    padding-inline: 0;
  }
  .platform-lemmy .vote-pill .icon,
  .platform-piefed .vote-pill .icon {
    width: 1.5rem;
    height: 1.5rem;
  }
  .platform-reddit .vote-pill .action:first-child:hover {
    color: #ff4500;
  }
  .platform-reddit .vote-pill .action:last-child:hover {
    color: #7193ff;
  }
  .platform-reddit .action:hover {
    background: var(--native-soft, #f2f2f2);
  }
</style>
