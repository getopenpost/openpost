<script lang="ts">
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import type { PreviewModel } from "./model";
  import PreviewAvatar from "./PreviewAvatar.svelte";
  import PreviewMedia from "./PreviewMedia.svelte";

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
    {#if model.title}<h2>{model.title}</h2>{/if}
    {#if model.business?.topic === "event" || model.business?.topic === "offer"}
      <span class="date-range"
        >{model.business.startDate}{model.business.startTime
          ? `, ${model.business.startTime}`
          : ""}{model.business.endDate
          ? ` to ${model.business.endDate}`
          : ""}{model.business.endTime
          ? `, ${model.business.endTime}`
          : ""}</span
      >
    {/if}
    {#if primary?.text}<p>{primary.text}</p>{/if}
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
    --native-muted: light-dark(#5f6368, #bdc1c6);
    width: min(100%, 30rem);
    overflow: hidden;
    border: 1px solid light-dark(#dadce0, #5f6368);
    border-radius: 0.75rem;
    background: var(--native-bg);
    color: var(--native-fg);
    font-family: Arial, sans-serif;
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
    font-size: 0.9rem;
    overflow-wrap: anywhere;
  }
  header span {
    color: var(--native-muted);
    font-size: 0.75rem;
  }
  header > :global(svg) {
    width: 1.25rem;
    flex: none;
  }
  .update-copy {
    display: grid;
    gap: 0.65rem;
    padding: 1rem;
  }
  h2 {
    margin: 0;
    font-size: 1.1rem;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }
  p {
    margin: 0;
    font-size: 0.9rem;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .link-label {
    color: light-dark(#1967d2, #8ab4f8);
    font-size: 0.87rem;
    font-weight: 600;
  }
  .compact header,
  .compact .update-copy {
    padding: 0.75rem;
  }
  .date-range,
  small {
    color: var(--native-muted);
    font-size: 0.78rem;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
  .coupon {
    font-size: 0.85rem;
    overflow-wrap: anywhere;
  }
</style>
