<script lang="ts">
  import DiscordPreview from "./DiscordPreview.svelte";
  import FacebookPreview from "./FacebookPreview.svelte";
  import InstagramPreview from "./InstagramPreview.svelte";
  import LinkedInPreview from "./LinkedInPreview.svelte";
  import MicroPreview from "./MicroPreview.svelte";
  import type { PreviewModel } from "./model";
  import { platformNames } from "./model";
  import TikTokPreview from "./TikTokPreview.svelte";
  import YouTubePreview from "./YouTubePreview.svelte";

  interface Props {
    model: PreviewModel;
    class?: string;
    compact?: boolean;
  }

  let { model, class: className = "", compact = false }: Props = $props();
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
  data-platform={model.platform}
  data-format={model.format}
  aria-label={previewLabel}
>
  {#if model.platform === "unsupported"}
    <div class="unsupported-preview" role="status">
      <strong>Preview unavailable</strong>
      <p>We cannot show a preview for this account yet.</p>
    </div>
  {:else if model.platform === "x"}
    <MicroPreview {model} platform="x" {compact} />
  {:else if model.platform === "mastodon"}
    <MicroPreview {model} platform="mastodon" {compact} />
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
  {/if}
</div>

<style>
  .social-preview {
    display: grid;
    width: 100%;
    place-items: center;
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
