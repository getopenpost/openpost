<script lang="ts">
  import { tick } from "svelte";

  interface Props {
    text: string;
    lines?: number;
    class?: string;
    buttonLabel?: string;
    author?: string;
  }

  let {
    text,
    lines = 3,
    class: className = "",
    buttonLabel = "See more",
    author,
  }: Props = $props();
  const contentId = $props.id();
  const lineLimit = $derived(Math.max(1, Math.floor(lines)));
  let expanded = $state(false);
  let truncated = $state(false);

  function observeOverflow(
    node: HTMLParagraphElement,
    options: { text: string; limit: number },
  ) {
    let active = true;
    let currentLimit = options.limit;
    function measure() {
      if (!active) return;
      // Measure the collapsed box even when expanded, without painting an intermediate state.
      const previousClamp = node.style.webkitLineClamp;
      node.style.webkitLineClamp = String(currentLimit);
      truncated = node.scrollHeight > node.clientHeight + 1;
      node.style.webkitLineClamp = previousClamp;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    void tick().then(measure);
    return {
      update(value: { text: string; limit: number }) {
        currentLimit = value.limit;
        expanded = false;
        void tick().then(measure);
      },
      destroy() {
        active = false;
        observer.disconnect();
      },
    };
  }
</script>

<div class={["preview-text", className]}>
  <p
    dir="auto"
    id={contentId}
    use:observeOverflow={{ text: `${author ?? ""}${text}`, limit: lineLimit }}
    style:-webkit-line-clamp={expanded ? "unset" : lineLimit}
  >
    {#if author}<strong><bdi>{author}</bdi></strong>{/if}{text}
  </p>
  {#if truncated}
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={contentId}
      onclick={() => (expanded = !expanded)}
      >{expanded ? "See less" : buttonLabel}</button
    >
  {/if}
</div>

<style>
  .preview-text {
    min-width: 0;
    color: inherit;
    font: inherit;
  }
  p {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    overflow: hidden;
    margin: 0;
    white-space: pre-wrap;
    unicode-bidi: plaintext;
    text-align: start;
    overflow-wrap: anywhere;
    font: inherit;
    color: inherit;
  }
  button {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--native-muted, currentColor);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  strong {
    margin-inline-end: 0.35rem;
  }
  button:hover {
    text-decoration: underline;
  }
  button:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 2px;
  }
  @media (pointer: coarse) {
    button {
      min-width: 44px;
      min-height: 44px;
    }
  }
</style>
