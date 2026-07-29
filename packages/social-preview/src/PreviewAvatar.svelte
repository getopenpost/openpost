<script lang="ts">
  import type { PreviewIdentity } from "./model";

  interface Props {
    identity: PreviewIdentity;
    size?: number;
    class?: string;
    ring?: boolean;
  }

  let {
    identity,
    size = 42,
    class: className = "",
    ring = false,
  }: Props = $props();
  const initials = $derived(
    identity.displayName
      .split(/\s+/u)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "OP",
  );
</script>

<span
  class={["preview-avatar", ring && "with-ring", className]}
  style:--avatar-size={`${size}px`}
  aria-hidden="true"
>
  {#if identity.avatarUrl}
    <img src={identity.avatarUrl} alt="" />
  {:else}
    {initials}
  {/if}
</span>

<style>
  .preview-avatar {
    display: grid;
    width: var(--avatar-size);
    height: var(--avatar-size);
    flex: 0 0 auto;
    place-items: center;
    overflow: hidden;
    border-radius: 50%;
    background: #e8eaf0;
    color: #3d4557;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: calc(var(--avatar-size) * 0.29);
    font-weight: 700;
    line-height: 1;
  }

  .preview-avatar.with-ring {
    box-shadow:
      0 0 0 2px var(--native-surface, #fff),
      0 0 0 4px #e1306c;
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
