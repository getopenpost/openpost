<script lang="ts">
  import PinterestPreview from "./PinterestPreview.svelte";
  import GoogleBusinessPreview from "./GoogleBusinessPreview.svelte";
  import DiscordPreview from "./DiscordPreview.svelte";
  import FacebookPreview from "./FacebookPreview.svelte";
  import InstagramPreview from "./InstagramPreview.svelte";
  import LinkedInPreview from "./LinkedInPreview.svelte";
  import CommunityPreview from "./CommunityPreview.svelte";
  import MicroPreview from "./MicroPreview.svelte";
  import type { PreviewModel } from "./model";
  import { platformNames } from "./model";
  import TikTokPreview from "./TikTokPreview.svelte";
  import TelegramPreview from "./TelegramPreview.svelte";
  import YouTubePreview from "./YouTubePreview.svelte";

  interface Props {
    model: PreviewModel;
    class?: string;
    compact?: boolean;
    scheme?: "light" | "dark" | "system";
  }

  let {
    model,
    class: className = "",
    compact = false,
    scheme = "system",
  }: Props = $props();
  const platformName = $derived(platformNames[model.platform]);
  const previewLabel = $derived(`${platformName} ${model.format} preview`);
</script>

<div
  class={[
    "social-preview",
    `platform-${model.platform}`,
    `format-${model.format}`,
    className,
  ]}
  data-preview-scheme={scheme}
  style:color-scheme={scheme === "system" ? undefined : scheme}
  data-platform={model.platform}
  data-format={model.format}
  aria-label={previewLabel}
>
  {#if model.platform === "unsupported"}
    <div class="unsupported-preview" role="status">
      <strong>Preview unavailable</strong>
      <p>We cannot show a preview for this account yet.</p>
    </div>
  {:else if model.platform === "pinterest"}
    <PinterestPreview {model} {compact} />
  {:else if model.platform === "googlebusiness"}
    <GoogleBusinessPreview {model} {compact} />
  {:else if model.platform === "reddit"}
    <CommunityPreview {model} platform="reddit" {compact} />
  {:else if model.platform === "x"}
    <MicroPreview {model} platform="x" {compact} />
  {:else if model.platform === "mastodon"}
    <MicroPreview {model} platform="mastodon" {compact} />
  {:else if model.platform === "pixelfed"}
    {#if model.format === "thread"}
      <div class="photo-thread">
        {#each model.segments as segment, index (segment.id)}
          <InstagramPreview
            platform="pixelfed"
            {compact}
            model={{
              ...model,
              format: "post",
              segments: [segment],
              media: index === 0 ? model.media : [],
              card: segment.card ?? (index === 0 ? model.card : undefined),
              poll: segment.poll ?? (index === 0 ? model.poll : undefined),
              contentWarning:
                segment.contentWarning ??
                (index === 0 ? model.contentWarning : undefined),
            }}
          />
        {/each}
      </div>
    {:else}<InstagramPreview {model} platform="pixelfed" {compact} />{/if}
  {:else if model.platform === "peertube"}
    <YouTubePreview {model} platform="peertube" {compact} />
  {:else if model.platform === "lemmy"}
    <CommunityPreview {model} platform="lemmy" {compact} />
  {:else if model.platform === "piefed"}
    <CommunityPreview {model} platform="piefed" {compact} />
  {:else if model.platform === "bluesky"}
    <MicroPreview {model} platform="bluesky" {compact} />
  {:else if model.platform === "threads"}
    <MicroPreview {model} platform="threads" {compact} />
  {:else if model.platform === "linkedin"}
    <LinkedInPreview {model} {compact} />
  {:else if model.platform === "instagram"}
    <InstagramPreview {model} {compact} />
  {:else if model.platform === "facebook"}
    <FacebookPreview {model} {compact} />
  {:else if model.platform === "youtube"}
    <YouTubePreview {model} {compact} />
  {:else if model.platform === "tiktok"}
    <TikTokPreview {model} {compact} />
  {:else if model.platform === "discord"}
    <DiscordPreview {model} {compact} />
  {:else if model.platform === "telegram"}
    <TelegramPreview {model} {compact} />
  {/if}
</div>

<style>
  .social-preview {
    display: grid;
    min-width: 0;
    width: 100%;
    color-scheme: light dark;
    container-type: inline-size;
    place-items: center;
  }

  :global(.dark) .social-preview[data-preview-scheme="system"] {
    color-scheme: dark;
  }
  :global(.light) .social-preview[data-preview-scheme="system"] {
    color-scheme: light;
  }
  .social-preview :global(*) {
    box-sizing: border-box;
  }
  .social-preview :global(button:focus-visible) {
    outline: 2px solid light-dark(#0068b5, #8acbff);
    outline-offset: 3px;
  }

  .photo-thread {
    display: grid;
    gap: 0.75rem;
    width: min(100%, 38rem);
  }

  .unsupported-preview {
    display: grid;
    width: min(100%, 36rem);
    min-height: 14rem;
    place-content: center;
    gap: 0.45rem;
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 0.75rem;
    background: var(--background, #fff);
    color: var(--foreground, #171717);
    padding: 2rem;
    text-align: center;
  }

  .unsupported-preview p {
    max-width: 28rem;
    margin: 0;
    color: var(--muted-foreground, #6b7280);
    font-size: 0.85rem;
    line-height: 1.5;
  }
</style>
