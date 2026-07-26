<script lang="ts">
	import { Check, Clipboard, ClipboardCopy, RotateCcw, Sparkles } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import {
		THREAD_PLATFORMS,
		copyToClipboard,
		graphemeCount,
		splitSmartThread,
		wordCount,
		type PlatformKey
	} from '../../tools/_lib/tool-utils';

	const example = `A useful content calendar starts with one clear idea, not a pile of empty slots. Decide what your audience should learn this week.

Then turn that idea into a short series: explain the problem, share the method, and end with one action readers can take. Each post should still make sense on its own.`;

	let draft = $state(example);
	let platform = $state<PlatformKey>('x');
	let numbering = $state(true);
	let copied = $state('');

	const selectedPlatform = $derived(
		THREAD_PLATFORMS.find((item) => item.key === platform) ?? THREAD_PLATFORMS[0]
	);
	const parts = $derived(
		splitSmartThread(draft, platform, selectedPlatform.limit, numbering)
	);
	const sourceCharacters = $derived(graphemeCount(draft));
	const sourceWords = $derived(wordCount(draft));

	async function copy(value: string, label: string) {
		try {
			await copyToClipboard(value);
			copied = label;
		} catch {
			copied = 'Clipboard unavailable';
		}
		window.setTimeout(() => {
			copied = '';
		}, 2200);
	}
</script>

<div class="mt-8 grid gap-5 xl:grid-cols-[minmax(20rem,0.84fr)_minmax(0,1.16fr)]">
	<section class="rounded-lg border bg-card p-4 sm:p-6" aria-labelledby="splitter-input-title">
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div>
				<h2 id="splitter-input-title" class="text-lg font-semibold">Source text</h2>
				<p class="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
					The splitter keeps paragraph and sentence breaks when they fit. Long words are carried over,
					not discarded.
				</p>
			</div>
			<div class="flex gap-2">
				<Button type="button" size="sm" variant="ghost" onclick={() => (draft = example)}>
					<Sparkles data-icon="inline-start" />
					Example
				</Button>
				<Button type="button" size="sm" variant="ghost" onclick={() => (draft = '')}>
					<RotateCcw data-icon="inline-start" />
					Clear
				</Button>
			</div>
		</div>

		<div class="mt-5 grid gap-4 sm:grid-cols-2">
			<div>
				<label for="thread-platform" class="text-sm font-medium">Destination</label>
				<select
					id="thread-platform"
					bind:value={platform}
					class="mt-2 min-h-11 w-full rounded-lg border bg-background px-3 text-sm"
				>
					{#each THREAD_PLATFORMS as item (item.key)}
						<option value={item.key}>{item.name} · {item.limit.toLocaleString()}</option>
					{/each}
				</select>
			</div>
			<label class="mt-auto flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2">
				<input type="checkbox" bind:checked={numbering} class="size-4 accent-primary" />
				<span>
					<span class="block text-sm font-medium">Add part numbers</span>
					<span class="block text-xs text-muted-foreground">Included in every limit.</span>
				</span>
			</label>
		</div>

		<label for="thread-source" class="sr-only">Text to split into a thread</label>
		<textarea
			id="thread-source"
			bind:value={draft}
			class="mt-4 min-h-80 w-full resize-y rounded-xl border bg-background p-4 text-base leading-7 focus-visible:ring-2 focus-visible:ring-ring"
			placeholder="Paste a draft, article excerpt, or notes..."
			spellcheck="true"
		></textarea>

		<dl class="mt-4 grid grid-cols-3 divide-x rounded-xl border bg-muted/20 py-3 text-center">
			<div class="px-2">
				<dt class="text-xs text-muted-foreground">Visible chars</dt>
				<dd class="mt-1 font-mono font-semibold">{sourceCharacters.toLocaleString()}</dd>
			</div>
			<div class="px-2">
				<dt class="text-xs text-muted-foreground">Words</dt>
				<dd class="mt-1 font-mono font-semibold">{sourceWords.toLocaleString()}</dd>
			</div>
			<div class="px-2">
				<dt class="text-xs text-muted-foreground">Parts</dt>
				<dd class="mt-1 font-mono font-semibold">{parts.length.toLocaleString()}</dd>
			</div>
		</dl>
	</section>

	<section class="rounded-lg border bg-card p-4 sm:p-6" aria-labelledby="thread-output-title">
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div>
				<div class="flex items-center gap-2.5">
					<PlatformIcon platform={selectedPlatform.key} class="size-5" />
					<h2 id="thread-output-title" class="text-lg font-semibold">Ready-to-copy thread</h2>
				</div>
				<p class="mt-1 text-sm text-muted-foreground">
					{selectedPlatform.name} · {selectedPlatform.limit.toLocaleString()} per part
				</p>
			</div>
			<Button
				type="button"
				size="sm"
				variant="outline"
				disabled={parts.length === 0}
				onclick={() => copy(parts.map((part) => part.text).join('\n\n---\n\n'), 'Thread copied')}
			>
				{#if copied === 'Thread copied'}
					<Check data-icon="inline-start" />
				{:else}
					<ClipboardCopy data-icon="inline-start" />
				{/if}
				Copy all
			</Button>
		</div>

		<p class="sr-only" aria-live="polite">{copied}</p>
		{#if parts.length === 0}
			<div class="mt-5 grid min-h-64 place-items-center rounded-xl border border-dashed bg-muted/15 p-8 text-center">
				<div>
					<Clipboard class="mx-auto size-6 text-muted-foreground" />
					<p class="mt-3 font-medium">Add text to build a thread</p>
					<p class="mt-1 text-sm text-muted-foreground">Your draft stays in this browser tab.</p>
				</div>
			</div>
		{:else}
			<ol class="mt-5 grid gap-3">
				{#each parts as part, index (`${index}-${part.text}`)}
					<li class="rounded-xl border bg-background p-4">
						<div class="flex items-center justify-between gap-3">
							<p class="text-sm font-semibold">Part {index + 1}</p>
							<div class="flex items-center gap-3">
								<span
									class={[
										'font-mono text-xs text-muted-foreground',
										part.count > selectedPlatform.limit && '!text-destructive'
									]}
								>
									{part.count} / {selectedPlatform.limit}
								</span>
								<Button
									type="button"
									size="icon-sm"
									variant="ghost"
									aria-label={`Copy part ${index + 1}`}
									onclick={() => copy(part.text, `Part ${index + 1} copied`)}
								>
									{#if copied === `Part ${index + 1} copied`}
										<Check />
									{:else}
										<ClipboardCopy />
									{/if}
								</Button>
							</div>
						</div>
						<p class="mt-3 whitespace-pre-wrap break-words text-[0.94rem] leading-6">{part.text}</p>
					</li>
				{/each}
			</ol>
		{/if}
	</section>
</div>
