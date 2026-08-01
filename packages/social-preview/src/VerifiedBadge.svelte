<script lang="ts">
  import type { PreviewPlatformKey } from "./model";

  interface Props {
    platform: PreviewPlatformKey;
    class?: string;
  }

  let { platform, class: className = "" }: Props = $props();
</script>

<span
  class={["verified-badge", `platform-${platform}`, className]}
  role="img"
  aria-label="Verified"
>
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {#if platform === "instagram" || platform === "threads"}
      <path
        d="m12 1 2.4 2.2 3.2-.4 1.3 3 3 1.3-.4 3.2L23 12l-2.2 2.4.4 3.2-3 1.3-1.3 3-3.2-.4L12 23l-2.4-2.2-3.2.4-1.3-3-3-1.3.4-3.2L1 12l2.2-2.4-.4-3.2 3-1.3 1.3-3 3.2.4z"
      />
    {:else}
      <circle cx="12" cy="12" r="11" />
    {/if}
    <path class="check" d="m7.4 12.2 2.8 2.8 6.5-7" />
  </svg>
</span>

<style>
  .verified-badge {
    display: inline-grid;
    width: 1rem;
    height: 1rem;
    flex: 0 0 auto;
    place-items: center;
    color: #1d9bf0;
  }

  .verified-badge.platform-linkedin,
  .verified-badge.platform-facebook {
    color: #0a66c2;
  }

  .verified-badge.platform-instagram,
  .verified-badge.platform-threads {
    color: #0095f6;
  }

  svg {
    width: 100%;
    height: 100%;
    overflow: visible;
  }

  svg > :not(.check) {
    fill: currentColor;
  }

  .check {
    fill: none;
    stroke: white;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 2.5;
  }
</style>
