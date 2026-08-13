<script lang="ts">
	import { OpenPostFabricAdapter } from '../fabric-adapter';
	import type { ImageEditorDocument, ImageEditorPage } from '../types';

	let {
		document,
		class: className = '',
		label,
		page: explicitPage,
		compact = false
	}: {
		document: ImageEditorDocument;
		class?: string;
		label?: string;
		page?: ImageEditorPage;
		compact?: boolean;
	} = $props();

	let page = $derived(explicitPage ?? document.pages[0]);
	let adapter = $state.raw<OpenPostFabricAdapter | null>(null);
	let renderError = $state(false);

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
		const nextDocument = document;
		const nextPage = page;
		const currentAdapter = adapter;
		if (!currentAdapter || !nextPage) return;
		renderError = false;
		void currentAdapter.sync(nextDocument, nextPage).catch(() => {
			if (adapter === currentAdapter) renderError = true;
		});
	});
</script>

<div
	class="flex size-full items-center justify-center overflow-hidden bg-neutral-800 {compact
		? 'p-0.5'
		: 'p-3'} {className}"
>
	{#if page}
		<div
			class="template-preview-frame relative max-h-full max-w-full overflow-hidden shadow-sm"
			role="img"
			aria-label={label || document.title}
			style:aspect-ratio={`${document.width_px} / ${document.height_px}`}
			style:width={document.width_px / document.height_px >= 4 / 3 ? '100%' : 'auto'}
			style:height={document.width_px / document.height_px >= 4 / 3 ? 'auto' : '100%'}
		>
			<canvas {@attach attachPreview} class="block size-full" aria-hidden="true"></canvas>
			{#if renderError}
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
	.template-preview-frame {
		--image-editor-checker-light: color-mix(in oklch, var(--background) 72%, var(--foreground));
		--image-editor-checker-dark: color-mix(in oklch, var(--background) 58%, var(--foreground));
		background-color: var(--image-editor-checker-light);
		background-image:
			linear-gradient(45deg, var(--image-editor-checker-dark) 25%, transparent 25%),
			linear-gradient(-45deg, var(--image-editor-checker-dark) 25%, transparent 25%),
			linear-gradient(45deg, transparent 75%, var(--image-editor-checker-dark) 75%),
			linear-gradient(-45deg, transparent 75%, var(--image-editor-checker-dark) 75%);
		background-position:
			0 0,
			0 8px,
			8px -8px,
			-8px 0;
		background-size: 16px 16px;
	}
</style>
