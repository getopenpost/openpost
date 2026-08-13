<script lang="ts">
  import { RotateCcw, Sparkles } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";
  import { Textarea } from "$lib/components/ui/textarea";
  import PlatformIcon from "$lib/components/platform-icon.svelte";
  import {
    COUNTER_PLATFORMS,
    graphemeCount,
    platformTextCount,
    wordCount,
  } from "../../tools/_lib/tool-utils";

  const example =
    "New in OpenPost: write once, tailor each account version, and check every post before you schedule it. https://openpost.social";
  let draft = $state(example);

  const visibleCharacters = $derived(graphemeCount(draft));
  const words = $derived(wordCount(draft));
  const lines = $derived(draft ? draft.split(/\r?\n/u).length : 0);
  const platformCounts = $derived(
    COUNTER_PLATFORMS.map((platform) => ({
      ...platform,
      count: platformTextCount(draft, platform.key),
    })),
  );
</script>

<div
  class="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1.08fr)_minmax(22rem,0.92fr)]"
>
  <section
    class="rounded-lg border bg-card p-4 sm:p-6"
    aria-labelledby="counter-input-title"
  >
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 id="counter-input-title" class="text-lg font-semibold">
          Your post
        </h2>
        <p class="mt-1 text-sm text-muted-foreground">
          Counts update as you type. Composed emoji stay together as one visible
          character.
        </p>
      </div>
      <div class="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onclick={() => (draft = example)}
        >
          <Sparkles data-icon="inline-start" />
          Example
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onclick={() => (draft = "")}
        >
          <RotateCcw data-icon="inline-start" />
          Clear
        </Button>
      </div>
    </div>

    <label for="character-counter-input" class="sr-only">Post text</label>
    <Textarea
      id="character-counter-input"
      bind:value={draft}
      class="mt-5 min-h-72 p-4 text-base leading-7 md:text-base"
      placeholder="Paste or write a social post..."
      spellcheck="true"
    />

    <dl
      class="mt-4 grid grid-cols-3 divide-x rounded-xl border bg-muted/20 py-3 text-center"
    >
      <div class="px-2">
        <dt class="text-xs text-muted-foreground">Visible chars</dt>
        <dd class="mt-1 font-mono text-lg font-semibold">
          {visibleCharacters.toLocaleString()}
        </dd>
      </div>
      <div class="px-2">
        <dt class="text-xs text-muted-foreground">Words</dt>
        <dd class="mt-1 font-mono text-lg font-semibold">
          {words.toLocaleString()}
        </dd>
      </div>
      <div class="px-2">
        <dt class="text-xs text-muted-foreground">Lines</dt>
        <dd class="mt-1 font-mono text-lg font-semibold">
          {lines.toLocaleString()}
        </dd>
      </div>
    </dl>
  </section>

  <section
    class="rounded-lg border bg-card p-4 sm:p-6"
    aria-labelledby="platform-counts-title"
  >
    <div>
      <h2 id="platform-counts-title" class="text-lg font-semibold">
        Social network limits
      </h2>
      <p class="mt-1 text-sm text-muted-foreground">
        Compare one draft before adapting it per platform.
      </p>
    </div>

    <div class="mt-5 grid gap-3">
      {#each platformCounts as platform (platform.key)}
        {@const remaining = platform.limit - platform.count}
        {@const percentage = Math.min(
          100,
          (platform.count / platform.limit) * 100,
        )}
        <article class="rounded-xl border bg-background p-4">
          <div class="flex items-center justify-between gap-4">
            <div class="inline-flex min-w-0 items-center gap-2.5">
              <PlatformIcon platform={platform.key} class="size-5 shrink-0" />
              <h3 class="truncate text-sm font-semibold">{platform.name}</h3>
            </div>
            <span
              class={[
                "font-mono text-sm text-muted-foreground",
                remaining < 0 && "!text-destructive",
              ]}
            >
              {platform.count.toLocaleString()} / {platform.limit.toLocaleString()}
            </span>
          </div>
          <div
            class="mt-3 h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label={`${platform.name} character use`}
            aria-valuemin="0"
            aria-valuemax={platform.limit}
            aria-valuenow={Math.min(platform.count, platform.limit)}
          >
            <div
              class={[
                "h-full rounded-full bg-primary transition-[width]",
                remaining < 0 && "!bg-destructive",
              ]}
              style:width={`${percentage}%`}
            ></div>
          </div>
          <div
            class="mt-2 flex items-start justify-between gap-3 text-xs leading-5"
          >
            <p class="text-muted-foreground">{platform.note}</p>
            <p
              class={[
                "shrink-0 font-medium text-primary",
                remaining < 0 && "!text-destructive",
              ]}
            >
              {remaining >= 0
                ? `${remaining.toLocaleString()} left`
                : `${Math.abs(remaining).toLocaleString()} over`}
            </p>
          </div>
        </article>
      {/each}
    </div>
  </section>
</div>
