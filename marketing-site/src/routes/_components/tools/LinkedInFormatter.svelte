<script lang="ts">
  import { Check, ClipboardCopy, RotateCcw, Sparkles } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { Textarea } from "$lib/components/ui/textarea";
  import AppSelect from "$lib/components/app-select.svelte";
  import {
    copyToClipboard,
    formatLinkedInText,
    graphemeCount,
    wordCount,
  } from "../../tools/_lib/tool-utils";

  const example = `Most content plans fail before anyone writes a post. The team has a calendar, but no shared reason for what goes into it. Every deadline becomes a new debate.

Start with three decisions:
- who the post is for
- what they should understand
- what they can do next

That short brief makes editing faster and gives each post a job.`;

  let draft = $state(example);
  let sentencesPerParagraph = $state(2);
  let normalizeBullets = $state(true);
  let copied = $state(false);

  const formatted = $derived(
    formatLinkedInText(draft, { sentencesPerParagraph, normalizeBullets }),
  );
  const characterCount = $derived(graphemeCount(formatted));
  const words = $derived(wordCount(formatted));
  const paragraphs = $derived(
    formatted ? formatted.split(/\n{2,}/u).length : 0,
  );
  const firstBlock = $derived(formatted.split(/\n{2,}/u)[0] ?? "");
  const longestBlock = $derived(
    Math.max(
      0,
      ...formatted
        .split(/\n{2,}/u)
        .map((paragraph) => graphemeCount(paragraph)),
    ),
  );

  async function copyResult() {
    try {
      await copyToClipboard(formatted);
      copied = true;
      window.setTimeout(() => (copied = false), 2200);
    } catch {
      copied = false;
    }
  }
</script>

<div class="mt-8 grid gap-5 xl:grid-cols-2">
  <section
    class="rounded-lg border bg-card p-4 sm:p-6"
    aria-labelledby="formatter-input-title"
  >
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 id="formatter-input-title" class="text-lg font-semibold">
          Original draft
        </h2>
        <p class="mt-1 max-w-lg text-sm leading-6 text-muted-foreground">
          Improve spacing and list structure while keeping every letter readable
          and searchable.
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

    <label for="linkedin-source" class="sr-only">LinkedIn post draft</label>
    <Textarea
      id="linkedin-source"
      bind:value={draft}
      class="mt-5 min-h-80 p-4 text-base leading-7 md:text-base"
      placeholder="Paste a LinkedIn draft..."
      spellcheck="true"
    />

    <fieldset class="mt-4 grid gap-4 sm:grid-cols-2">
      <legend class="sr-only">Formatting options</legend>
      <div class="grid gap-2">
        <label for="paragraph-length" class="text-sm font-medium"
          >Paragraph length</label
        >
        <AppSelect
          id="paragraph-length"
          value={String(sentencesPerParagraph)}
          options={[
            { value: "1", label: "One sentence" },
            { value: "2", label: "Up to two sentences" },
            { value: "3", label: "Up to three sentences" },
            { value: "0", label: "Keep original paragraphs" },
          ]}
          class="h-11 w-full md:h-11"
          ariaLabel="Paragraph length"
          onValueChange={(value) => (sentencesPerParagraph = Number(value))}
        />
      </div>
      <label
        class="flex min-h-11 cursor-pointer items-center gap-3 self-end rounded-lg border px-3 py-2"
      >
        <Checkbox bind:checked={normalizeBullets} />
        <span class="text-sm font-medium">Use the same bullet style</span>
      </label>
    </fieldset>
  </section>

  <section
    class="rounded-lg border bg-card p-4 sm:p-6"
    aria-labelledby="formatter-output-title"
  >
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 id="formatter-output-title" class="text-lg font-semibold">
          Formatted post
        </h2>
        <p class="mt-1 text-sm text-muted-foreground">
          Plain text that remains searchable and accessible.
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!formatted}
        onclick={copyResult}
      >
        {#if copied}<Check data-icon="inline-start" />{:else}<ClipboardCopy
            data-icon="inline-start"
          />{/if}
        {copied ? "Copied" : "Copy post"}
      </Button>
    </div>
    <p class="sr-only" aria-live="polite">
      {copied ? "Formatted post copied." : ""}
    </p>

    <Textarea
      readonly
      value={formatted}
      aria-label="Formatted LinkedIn post"
      class="mt-5 min-h-80 p-4 text-base leading-7 md:text-base"
      placeholder="Your formatted post will appear here."
    />

    <dl
      class="mt-4 grid grid-cols-3 divide-x rounded-xl border bg-muted/20 py-3 text-center"
    >
      <div class="px-2">
        <dt class="text-xs text-muted-foreground">Characters</dt>
        <dd
          class={[
            "mt-1 font-mono font-semibold",
            characterCount > 3000 && "text-destructive",
          ]}
        >
          {characterCount.toLocaleString()}
        </dd>
      </div>
      <div class="px-2">
        <dt class="text-xs text-muted-foreground">Words</dt>
        <dd class="mt-1 font-mono font-semibold">{words.toLocaleString()}</dd>
      </div>
      <div class="px-2">
        <dt class="text-xs text-muted-foreground">Paragraphs</dt>
        <dd class="mt-1 font-mono font-semibold">
          {paragraphs.toLocaleString()}
        </dd>
      </div>
    </dl>

    <div class="mt-4 grid gap-3 sm:grid-cols-2">
      <div class="rounded-xl border bg-background p-4">
        <p class="text-xs font-medium text-muted-foreground">Opening block</p>
        <p class="mt-1 text-sm font-medium">
          {firstBlock
            ? `${graphemeCount(firstBlock)} characters`
            : "Add a draft to check the opening."}
        </p>
      </div>
      <div class="rounded-xl border bg-background p-4">
        <p class="text-xs font-medium text-muted-foreground">Longest block</p>
        <p class="mt-1 text-sm font-medium">
          {longestBlock > 0 ? `${longestBlock} characters` : "No paragraph yet"}
        </p>
      </div>
    </div>

    {#if characterCount > 3000}
      <p
        class="mt-4 rounded-lg border border-destructive/30 bg-destructive/[0.04] p-3 text-sm text-destructive"
      >
        This draft is {characterCount - 3000} characters over LinkedIn's 3,000-character
        post limit.
      </p>
    {/if}
  </section>
</div>
