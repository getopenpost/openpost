<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { OpenPostFabricAdapter } from '../fabric-adapter';
	import { queueImageEditorPreview } from '../preview-queue';
	import type { ImageEditorDocument, ImageEditorPage } from '../types';

	let {
		document,
		class: className = '',
		label,
		page: explicitPage,
		compact = false,
		deferUpdates = false,
		cached = false,
		dimensionKey: explicitDimensionKey
	}: {
		document: ImageEditorDocument;
		class?: string;
		label?: string;
		page?: ImageEditorPage;
		compact?: boolean;
		deferUpdates?: boolean;
		cached?: boolean;
		dimensionKey?: string;
	} = $props();

	let page = $derived(explicitPage ?? document.pages[0]);
	let dimensionKey = $derived(explicitDimensionKey ?? `${document.width_px}:${document.height_px}`);
	let adapter = $state.raw<OpenPostFabricAdapter | null>(null);
	let renderError = $state(false);
	let imageURL = $state('');
	let visible = $state(false);
	let lastRenderedPage: ImageEditorPage | null = null;
	let lastRenderedDimensionKey = '';

	function observePreview(node: HTMLElement): () => void {
		if (!cached) return () => undefined;
		if (!('IntersectionObserver' in globalThis)) {
			visible = true;
			return () => (visible = false);
		}
		const observer = new IntersectionObserver((entries) => {
			visible = Boolean(entries[0]?.isIntersecting);
		});
		observer.observe(node);
		return () => {
			observer.disconnect();
			visible = false;
		};
	}

	onDestroy(() => {
		if (imageURL) URL.revokeObjectURL(imageURL);
	});

	function attachPreview(canvas: HTMLCanvasElement): () => void {
		let disposed = false;
		const currentPage = page;
		if (!currentPage) return () => undefined;
		const renderScale = Math.min(1, 512 / Math.max(document.width_px, document.height_px));
		const next = new OpenPostFabricAdapter({
			canvas,
			document,
			page: currentPage,
			readOnly: true,
			staticCanvas: true,
			renderScale,
			onSelection() {},
			onTransform() {},
			onTextChange() {}
		});
		adapter = next;
		renderError = false;
		void next
			.mount()
			.then(() => {
				if (!disposed && page) return next.sync(document, page);
			})
			.catch(() => {
				if (!disposed) renderError = true;
			});
		return () => {
			disposed = true;
			if (adapter === next) adapter = null;
			next.dispose();
		};
	}

	$effect(() => {
		const nextPage = page;
		const currentAdapter = adapter;
		if (cached || !currentAdapter || !nextPage || deferUpdates) return;
		const nextDocument = untrack(() => document);
		renderError = false;
		void currentAdapter.sync(nextDocument, nextPage).catch(() => {
			if (adapter === currentAdapter) renderError = true;
		});
	});

	$effect(() => {
		const nextPage = page;
		const nextDimensionKey = dimensionKey;
		if (!cached || !visible || deferUpdates || !nextPage) return;
		if (imageURL && lastRenderedPage === nextPage && lastRenderedDimensionKey === nextDimensionKey)
			return;
		const nextDocument = untrack(() => document);
		const controller = new AbortController();
		renderError = false;
		void queueImageEditorPreview(nextDocument, nextPage, controller.signal)
			.then((blob) => {
				if (controller.signal.aborted) return;
				const previousURL = imageURL;
				imageURL = URL.createObjectURL(blob);
				lastRenderedPage = nextPage;
				lastRenderedDimensionKey = nextDimensionKey;
				if (previousURL) URL.revokeObjectURL(previousURL);
			})
			.catch(() => {
				if (!controller.signal.aborted) renderError = true;
			});
		return () => controller.abort();
	});
</script>

<div
	class="flex size-full items-center justify-center overflow-hidden bg-[var(--canvas-pasteboard)] {compact
		? 'p-0.5'
		: 'p-3'} {className}"
>
	{#if page}
		<div
			{@attach observePreview}
			class="template-preview-frame pasteboard-checker relative max-h-full max-w-full overflow-hidden shadow-sm"
			role="img"
			aria-label={label || document.title}
			style:aspect-ratio={`${document.width_px} / ${document.height_px}`}
			style:width={document.width_px / document.height_px >= 4 / 3 ? '100%' : 'auto'}
			style:height={document.width_px / document.height_px >= 4 / 3 ? 'auto' : '100%'}
		>
			{#if cached}
				{#if imageURL}<img src={imageURL} alt="" class="block size-full object-contain" />{/if}
			{:else}
				{#key dimensionKey}
					<canvas {@attach attachPreview} class="block size-full" aria-hidden="true"></canvas>
				{/key}
			{/if}
			{#if renderError && !imageURL}
				<div
					class="absolute inset-0 grid place-items-center bg-neutral-900/90 px-2 text-center text-xs text-neutral-200"
					role="status"
				>
					{label || document.title}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	/* Fabric owns bitmap resolution and writes inline CSS dimensions. The gallery
	   owns display size so the entire bitmap fits, including after a sync. */
	.template-preview-frame canvas {
		width: 100% !important;
		height: 100% !important;
	}
</style>
