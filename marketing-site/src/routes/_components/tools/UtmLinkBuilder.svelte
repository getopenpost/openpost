<script lang="ts">
	import { Check, ClipboardCopy, Link2 } from '@lucide/svelte';
	import { onDestroy } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { copyToClipboard } from '../../tools/_lib/tool-utils';

	type CopyState = 'idle' | 'copied' | 'failed';

	let destination = $state('');
	let source = $state('');
	let medium = $state('social');
	let campaign = $state('');
	let term = $state('');
	let content = $state('');
	let copiedUrl = $state('');
	let failedUrl = $state('');
	let copyResetTimer: number | undefined;
	const sourcePresets = [
		{ label: 'Instagram', source: 'instagram', medium: 'social' },
		{ label: 'LinkedIn', source: 'linkedin', medium: 'social' },
		{ label: 'Newsletter', source: 'newsletter', medium: 'email' }
	] as const;

	const result = $derived.by(() => {
		if (!destination.trim()) return { url: '', error: '' };

		let url: URL;
		try {
			url = new URL(destination.trim());
		} catch {
			return { url: '', error: 'Enter a full link, including https://.' };
		}

		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			return { url: '', error: 'Use an http or https link.' };
		}

		if (!source.trim() || !medium.trim() || !campaign.trim()) {
			return { url: '', error: 'Add a source, medium, and campaign name.' };
		}

		const requiredTags = [
			['utm_source', source],
			['utm_medium', medium],
			['utm_campaign', campaign]
		] as const;

		for (const [name, value] of requiredTags) {
			url.searchParams.set(name, value.trim());
		}
		if (term.trim()) url.searchParams.set('utm_term', term.trim());
		if (content.trim()) url.searchParams.set('utm_content', content.trim());

		return { url: url.toString(), error: '' };
	});
	const copyState = $derived<CopyState>(
		result.url && result.url === copiedUrl
			? 'copied'
			: result.url && result.url === failedUrl
				? 'failed'
				: 'idle'
	);

	async function copyLink() {
		if (!result.url) return;
		const url = result.url;
		if (copyResetTimer !== undefined) window.clearTimeout(copyResetTimer);
		try {
			await copyToClipboard(url);
			copiedUrl = url;
			failedUrl = '';
			copyResetTimer = window.setTimeout(() => {
				if (copiedUrl === url) copiedUrl = '';
			}, 2200);
		} catch {
			copiedUrl = '';
			failedUrl = url;
		}
	}

	function applySourcePreset(preset: (typeof sourcePresets)[number]) {
		source = preset.source;
		medium = preset.medium;
	}

	onDestroy(() => {
		if (copyResetTimer !== undefined) window.clearTimeout(copyResetTimer);
	});
</script>

<div class="mt-8 grid gap-5 xl:grid-cols-[minmax(21rem,0.9fr)_minmax(0,1.1fr)]">
	<section class="rounded-lg border bg-card p-4 sm:p-6" aria-labelledby="campaign-link-inputs">
		<div
			class="flex size-10 items-center justify-center rounded-xl border bg-background text-primary"
		>
			<Link2 class="size-5" aria-hidden="true" />
		</div>
		<h2 id="campaign-link-inputs" class="mt-4 text-lg font-semibold">Add campaign tags</h2>
		<p class="mt-1 text-sm leading-6 text-muted-foreground">
			Use names you will recognize in your analytics. The link stays on this page until you copy it.
		</p>

		<div class="mt-6 grid gap-4">
			<label for="utm-destination" class="grid gap-2 text-sm font-medium">
				Page link
				<Input
					id="utm-destination"
					type="url"
					bind:value={destination}
					placeholder="https://example.com/launch"
					class="h-11"
				/>
			</label>

			<div class="grid gap-4 sm:grid-cols-2">
				<label for="utm-source" class="grid gap-2 text-sm font-medium">
					Source
					<Input id="utm-source" bind:value={source} placeholder="linkedin" class="h-11" />
				</label>
				<label for="utm-medium" class="grid gap-2 text-sm font-medium">
					Medium
					<Input id="utm-medium" bind:value={medium} placeholder="social" class="h-11" />
				</label>
			</div>

			<fieldset>
				<legend class="text-sm font-medium">Quick source</legend>
				<div class="mt-2 flex flex-wrap gap-2">
					{#each sourcePresets as preset (preset.label)}
						{@const active = source === preset.source && medium === preset.medium}
						<Button
							type="button"
							size="sm"
							variant={active ? 'default' : 'outline'}
							aria-pressed={active}
							class="min-h-11"
							onclick={() => applySourcePreset(preset)}
						>
							{preset.label}
						</Button>
					{/each}
				</div>
			</fieldset>

			<label for="utm-campaign" class="grid gap-2 text-sm font-medium">
				Campaign
				<Input id="utm-campaign" bind:value={campaign} placeholder="summer-launch" class="h-11" />
			</label>

			<details class="rounded-lg border bg-background px-4 py-3">
				<summary class="focus-ring min-h-11 cursor-pointer py-2 text-sm font-medium">
					Optional tags
				</summary>
				<div class="grid gap-4 pt-3 sm:grid-cols-2">
					<label for="utm-term" class="grid gap-2 text-sm font-medium">
						Term
						<Input id="utm-term" bind:value={term} placeholder="founder-tools" class="h-11" />
					</label>
					<label for="utm-content" class="grid gap-2 text-sm font-medium">
						Content
						<Input id="utm-content" bind:value={content} placeholder="video-post" class="h-11" />
					</label>
				</div>
			</details>
		</div>
	</section>

	<section class="rounded-lg border bg-card p-4 sm:p-6" aria-labelledby="campaign-link-output">
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div>
				<h2 id="campaign-link-output" class="text-lg font-semibold">Your finished link</h2>
				<p class="mt-1 text-sm leading-6 text-muted-foreground">
					Existing query details and the page anchor are kept.
				</p>
			</div>
			<Button type="button" size="sm" variant="outline" disabled={!result.url} onclick={copyLink}>
				{#if copyState === 'copied'}
					<Check data-icon="inline-start" />
					Copied
				{:else}
					<ClipboardCopy data-icon="inline-start" />
					Copy link
				{/if}
			</Button>
		</div>

		<div class="mt-5 min-h-48 rounded-xl border bg-background p-4">
			{#if result.url}
				<p class="font-mono text-sm leading-6 break-all" data-testid="utm-result">{result.url}</p>
			{:else}
				<p class="text-sm leading-6 text-muted-foreground">
					Add a page link, source, medium, and campaign name. Your finished link will appear here.
				</p>
			{/if}
		</div>

		{#if result.error}
			<p class="mt-3 text-sm text-destructive" role="alert">{result.error}</p>
		{/if}
		<p class="sr-only" aria-live="polite">
			{copyState === 'copied'
				? 'Campaign link copied.'
				: copyState === 'failed'
					? 'The campaign link could not be copied.'
					: ''}
		</p>
	</section>
</div>
