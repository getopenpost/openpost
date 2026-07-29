<script lang="ts">
  import type { PreviewPlatformKey, PreviewPoll } from "./model";

  interface Props {
    poll: PreviewPoll;
    platform: PreviewPlatformKey;
  }

  let { poll, platform }: Props = $props();
</script>

<div class={["preview-poll", `platform-${platform}`]} aria-label="Poll preview">
  {#each poll.options as option, index (`${option}-${index}`)}
    <div class="poll-option">
      <span>{option || `Option ${index + 1}`}</span>
      {#if platform === "mastodon"}<i
          style:--poll-width={`${Math.max(12, 42 - index * 8)}%`}
        ></i>{/if}
    </div>
  {/each}
  <small>
    {poll.allowMultiple ? "Choose one or more" : "Choose one"}
    {#if poll.durationLabel}
      · {poll.durationLabel}{/if}
  </small>
</div>

<style>
  .preview-poll {
    display: grid;
    gap: 0.5rem;
    margin-top: 0.8rem;
  }

  .poll-option {
    position: relative;
    display: flex;
    min-height: 2.25rem;
    align-items: center;
    overflow: hidden;
    border: 1px solid var(--poll-accent, #1d9bf0);
    border-radius: 999px;
    padding: 0.45rem 0.75rem;
    color: var(--native-fg, #0f1419);
    font-size: 0.82rem;
    font-weight: 650;
  }

  .poll-option span {
    position: relative;
    z-index: 1;
  }

  small {
    color: var(--native-muted, #536471);
    font-size: 0.72rem;
  }

  .platform-mastodon {
    --poll-accent: #6364ff;
  }

  .platform-mastodon .poll-option {
    border-color: #6d7180;
    border-radius: 0.3rem;
    background: #2f3441;
    color: #fff;
  }

  .platform-mastodon .poll-option i {
    position: absolute;
    inset: 0 auto 0 0;
    width: var(--poll-width);
    background: rgb(99 100 255 / 32%);
  }

  .platform-linkedin {
    --poll-accent: #0a66c2;
  }

  .platform-linkedin .poll-option {
    border-width: 2px;
    color: #0a66c2;
  }

  .platform-threads {
    --poll-accent: #d7d7d7;
  }
</style>
