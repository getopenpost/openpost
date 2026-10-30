<script lang="ts">
  import { previewEditing } from "./editing";
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import type { PreviewModel } from "./model";
  import PreviewAvatar from "./PreviewAvatar.svelte";
  import PreviewMedia from "./PreviewMedia.svelte";

  const editing = previewEditing();

  let { model, compact = false }: { model: PreviewModel; compact?: boolean } =
    $props();
  const actionLabels = {
    book: "Book",
    order: "Order online",
    shop: "Shop",
    learn_more: "Learn more",
    sign_up: "Sign up",
    call: "Call now",
  };
  const primary = $derived(model.segments[0]);
  const media = $derived(primary?.media ?? model.media);
</script>

<article class={["business-preview", compact && "compact"]}>
  <header>
    <PreviewAvatar identity={model.identity} size={36} />
    <div>
      <strong>{model.identity.displayName}</strong><span
        >{model.createdAtLabel}</span
      >
    </div>
    <Ellipsis aria-hidden="true" />
  </header>
  {#if media.length}<PreviewMedia {media} layout="single" />{/if}
  <div class="update-copy">
    {#if model.title}<h2 dir="auto">{#if editing()?.title && primary}{@render editing()!.title!(model.title, primary)}{:else}{model.title}{/if}</h2>{/if}
    {#if model.business?.topic === "event" || model.business?.topic === "offer"}
      <span class="date-range"
        >{model.business.startDate}{model.business.startTime
          ? `, ${model.business.startTime}`
          : ""}{model.business.endDate
          ? ` - ${model.business.endDate}`
          : ""}{model.business.endTime
          ? `, ${model.business.endTime}`
          : ""}</span
      >
    {/if}
    {#if editing()?.text && primary}{@render editing()!.text(primary)}{:else if primary?.text}<p dir="auto">{primary.text}</p>{/if}
    {#if model.business?.topic === "offer"}
      {#if model.business.couponCode}<span class="coupon"
          >Code: <strong>{model.business.couponCode}</strong></span
        >{/if}
      {#if model.business.terms}<small>{model.business.terms}</small>{/if}
      <span class="link-label">View offer</span>
    {:else if model.business?.action}<span class="link-label"
        >{actionLabels[model.business.action]}</span
      >
    {/if}
  </div>
</article>

<style>
  .business-preview {
    --native-bg: light-dark(#fff, #202124);
    --native-fg: light-dark(#202124, #e8eaed);
    --native-muted: light-dark(#5f6368, #9aa0a6);
    --native-ui-font: "Google Sans", "Google Sans Text", Roboto, Arial, sans-serif;
    width: min(100%, 30rem);
    overflow: hidden;
    border: 1px solid light-dark(#dadce0, #5f6368);
    border-radius: 0.75rem;
    background: var(--native-bg);
    color: var(--native-fg);
    font-family: "Google Sans Text", Roboto, Arial, sans-serif;
  }
  header {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 1rem;
  }
  header > div {
    display: grid;
    flex: 1;
    min-width: 0;
    gap: 0.2rem;
  }
  header strong {
    font-family: var(--native-ui-font);
    font-size: 0.875rem;
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  header span {
    color: var(--native-muted);
    font-size: 0.8125rem;
  }
  header > :global(svg) {
    width: 1.25rem;
    flex: none;
    color: var(--native-muted);
  }
  .update-copy {
    display: grid;
    gap: 0.65rem;
    padding: 1rem;
  }
  h2 {
    margin: 0;
    font-family: var(--native-ui-font);
    font-size: 1rem;
    font-weight: 500;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }
  p {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.43;
    white-space: pre-wrap;
    unicode-bidi: plaintext;
    text-align: start;
    overflow-wrap: anywhere;
  }
  .link-label {
    color: light-dark(#1a73e8, #8ab4f8);
    font-family: var(--native-ui-font);
    font-size: 0.875rem;
    font-weight: 500;
  }
  .compact header,
  .compact .update-copy {
    padding: 0.75rem;
  }
  .date-range,
  small {
    color: var(--native-muted);
    font-size: 0.8125rem;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
  .coupon {
    font-size: 0.875rem;
    overflow-wrap: anywhere;
  }
  .coupon strong {
    font-weight: 500;
  }
</style>
