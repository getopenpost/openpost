<script lang="ts">
  import type { PreviewPlatformKey, PreviewPoll } from "./model";

  interface Props {
    poll: PreviewPoll;
    platform: PreviewPlatformKey;
  }

  let { poll, platform }: Props = $props();
</script>

<div class={["preview-poll", `platform-${platform}`]} aria-label="Poll preview">
  {#if poll.question}<p class="poll-question">{poll.question}</p>{/if}
  {#each poll.options as option, index (`${option}-${index}`)}
    <div class="poll-option">
      <span>{option || `Option ${index + 1}`}</span>
    </div>
  {/each}
  <small>
    {poll.allowMultiple ? "Choose one or more" : "Choose one"}
    {#if poll.durationLabel}
      · {poll.durationLabel}{/if}
  </small>
</div>

<style>
  .poll-question {
    margin: 0 0 0.5rem;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

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
    overflow-wrap: anywhere;
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
    border-color: var(--native-border, #6d7180);
    border-radius: 0.3rem;
    background: var(--native-surface, #2f3441);
    color: var(--native-fg, #fff);
  }

  .platform-linkedin {
    --poll-accent: #0a66c2;
  }

  .platform-linkedin .poll-option {
    border-width: 2px;
    color: light-dark(#0a66c2, #70b5f9);
  }

  .platform-threads {
    --poll-accent: #d7d7d7;
  }
</style>
