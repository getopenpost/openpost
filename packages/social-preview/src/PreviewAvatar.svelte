<script lang="ts">
  import type { PreviewIdentity } from "./model";

  interface Props {
    identity: PreviewIdentity;
    size?: number;
    class?: string;
    ring?: boolean;
    loading?: "lazy" | "eager";
  }

  let {
    identity,
    size = 42,
    class: className = "",
    ring = false,
    loading = "lazy",
  }: Props = $props();
  let failedUrl = $state<string | undefined>();
  let loadedUrl = $state<string | undefined>();
  const initials = $derived(
    identity.displayName
      .split(/\s+/u)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "OP",
  );
  const showImage = $derived(
    Boolean(identity.avatarUrl) && failedUrl !== identity.avatarUrl,
  );
  const imageReady = $derived(
    showImage && loadedUrl === identity.avatarUrl,
  );
</script>

{#snippet disc()}
  <span
    class={["preview-avatar", !ring && className]}
    style:--avatar-size={`${size}px`}
    aria-hidden="true"
  >
    {initials}
    {#if showImage}
      <img
        src={identity.avatarUrl}
        alt=""
        {loading}
        referrerpolicy="no-referrer"
        class:ready={imageReady}
        onload={() => (loadedUrl = identity.avatarUrl)}
        onerror={() => (failedUrl = identity.avatarUrl)}
      />
    {/if}
  </span>
{/snippet}

{#if ring}
  <span
    class={["preview-avatar-ring", className]}
    style:--avatar-size={`${size}px`}
    aria-hidden="true"
  >
    {@render disc()}
  </span>
{:else}
  {@render disc()}
{/if}

<style>
  .preview-avatar {
    position: relative;
    display: grid;
    width: var(--avatar-size);
    height: var(--avatar-size);
    flex: 0 0 auto;
    place-items: center;
    overflow: hidden;
    border-radius: 50%;
    background: light-dark(#e8eaf0, #2b3346);
    color: light-dark(#3d4557, #dbe1ee);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: calc(var(--avatar-size) * 0.29);
    font-weight: 700;
    line-height: 1;
  }

  .preview-avatar-ring {
    display: grid;
    width: calc(var(--avatar-size) + 6px);
    height: calc(var(--avatar-size) + 6px);
    flex: 0 0 auto;
    place-items: center;
    border-radius: 50%;
    background: linear-gradient(
      125deg,
      #ffd600 15%,
      #ff7a00 30%,
      #ff0169,
      #d300c5 70%,
      #7638fa 85%
    );
    padding: 2px;
  }

  /* One pixel of the card background separates the gradient band from the
     photo, like the real Stories ring. */
  .preview-avatar-ring .preview-avatar {
    box-shadow: 0 0 0 1px var(--native-bg, var(--native-surface, #fff));
  }

  img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
  }

  img.ready {
    opacity: 1;
  }
</style>
