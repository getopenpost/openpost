<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { LivePreview, LivePreviewError } from '$lib/live-preview.svelte';
	import { renderTextCardPreview } from '$lib/text-card-renderer';
	import { m } from '$lib/paraglide/messages';
	import {
		textCardRequestKey,
		type TextCardIdentity,
		type TextCardImage,
		type TextCardRequest,
		type TextCardResult
	} from '$lib/text-cards';
	import type { ComposerSettings } from './compose/modes';
	import InlineNotice from './inline-notice.svelte';
	import { Button } from '$lib/components/ui/button';

	let {
		request,
		visible = true,
		showImages = true,
		savedPreview,
		identity = null,
		defaults = {},
		onResult
	}: {
		request: TextCardRequest | null;
		visible?: boolean;
		showImages?: boolean;
		savedPreview?: TextCardResult;
		identity?: TextCardIdentity | null;
		// Catalogue defaults resolved via textCardDefaultsFrom, so a request that
		// omits styling keys the same way the resolved capability renders it.
		defaults?: ComposerSettings;
		onResult?: (result: TextCardResult) => void;
	} = $props();
	let latest: TextCardRequest | null = null;
	// The grace before the first render lets a saved card arrive without a
	// request; later edits stream at server speed.
	const preview = new LivePreview<TextCardImage[]>(
		(_, signal) => {
			if (!latest) throw new LivePreviewError(m.text_card_preview_failed());
			return renderTextCardPreview(latest, signal).catch((cause) => {
				if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
				throw new LivePreviewError(
					cause instanceof Error ? cause.message : m.text_card_preview_failed()
				);
			});
		},
		{ initialDelayMs: 350 }
	);
	const key = $derived(textCardRequestKey(request, identity, defaults));
	const saved = $derived(savedPreview && savedPreview.key === key ? savedPreview : null);
	// Until the first live render lands, the last saved cards stay on screen.
	const images = $derived(saved?.images ?? preview.current ?? savedPreview?.images ?? []);
	$effect(() => {
		const requestKey = key;
		const input = request;
		latest = input;
		// A saved card for this exact request is shown without rendering.
		if (!input) preview.request(null);
		else if (saved) preview.cancel();
		else preview.request(requestKey);
	});
	onDestroy(() => preview.dispose());
	const result = $derived<TextCardResult>(
		saved ??
			(preview.error
				? { key, images: [], loading: false, error: preview.error.message }
				: preview.pending || preview.currentKey !== key
					? { key, images: [], loading: Boolean(request), error: '' }
					: { key, images: preview.current ?? [], loading: false, error: '' })
	);
	$effect(() => {
		const next = result;
		untrack(() => onResult?.(next));
	});
</script>

{#if visible && request}
	<div class="space-y-2" aria-busy={result.loading}>
		{#if result.error}
			<InlineNotice tone="error" message={result.error}>
				{#snippet actions()}<Button size="sm" variant="outline" onclick={() => preview.retry()}
						>{m.common_retry()}</Button
					>{/snippet}
			</InlineNotice>
		{/if}
		{#if showImages && images.length}
			<div
				class="flex snap-x gap-3 overflow-x-auto pb-1 transition-opacity duration-150"
				class:opacity-70={result.loading}
				class:delay-300={result.loading}
			>
				{#each images as image, index (index)}
					<img
						src={image.data_url}
						width={image.width}
						height={image.height}
						alt={m.text_card_preview_alt({ number: index + 1 })}
						class="max-h-96 w-full max-w-80 shrink-0 snap-center rounded-md border object-contain"
					/>
				{/each}
			</div>
		{/if}
	</div>
{/if}
