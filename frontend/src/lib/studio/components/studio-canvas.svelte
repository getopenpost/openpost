<script lang="ts">
	import { tick } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { Button } from '$lib/components/ui/button';
	import { OpenPostFabricAdapter } from '../fabric-adapter';
	import { useStudioEditor } from '../editor.svelte';
	import { m } from '$lib/paraglide/messages';
	import { startStudioMetric } from '../telemetry';

	const editor = useStudioEditor();
	let canvasElement = $state<HTMLCanvasElement>();
	let viewport = $state<HTMLDivElement>();
	let adapter = $state.raw<OpenPostFabricAdapter | null>(null);
	let canvasOriginDocument = editor.document;
	let ready = $state(false);
	let canvasError = $state('');
	let canvasAttempt = $state(0);
	let panning = $state(false);
	let panStart = { x: 0, y: 0, panX: 0, panY: 0 };
	const touchPointers = new SvelteMap<number, { x: number; y: number }>();
	let pinchStart = { distance: 0, zoom: 1, centerX: 0, centerY: 0, panX: 0, panY: 0 };

	function attachCanvas(node: HTMLCanvasElement) {
		canvasElement = node;
		let disposed = false;
		let mountedAdapter: OpenPostFabricAdapter | null = null;
		let resize: ResizeObserver | null = null;
		void (async () => {
			await tick();
			const viewportElement = viewport;
			if (!viewportElement || !editor.document || !editor.activePage) return;
			canvasError = '';
			const finishMetric = startStudioMetric('canvas_ready');
			const next = new OpenPostFabricAdapter({
				canvas: node,
				document: editor.document,
				page: editor.activePage,
				readOnly: !editor.canEdit,
				onSelection(ids) {
					editor.selectedLayerIDs = ids;
				},
				onTransform(id, updates) {
					editor.updateTransform(id, updates);
					canvasOriginDocument = editor.document;
				},
				onTextChange(id, text) {
					const layer = editor.activePage?.layers.find((item) => item.id === id);
					if (!layer?.text || layer.text.text === text) return;
					editor.updateLayer(id, { text: { ...layer.text, text } }, `text:${id}`);
					canvasOriginDocument = editor.document;
				}
			});
			mountedAdapter = next;
			try {
				await next.mount();
				if (disposed) {
					next.dispose();
					return;
				}
				adapter = next;
				editor.fitZoom(viewportElement.clientWidth, viewportElement.clientHeight);
				ready = true;
				let viewportWidth = viewportElement.clientWidth;
				let viewportHeight = viewportElement.clientHeight;
				resize = new ResizeObserver(() => {
					const nextWidth = viewportElement.clientWidth;
					const nextHeight = viewportElement.clientHeight;
					if (
						Math.abs(nextWidth - viewportWidth) > 32 ||
						Math.abs(nextHeight - viewportHeight) > 32
					) {
						viewportWidth = nextWidth;
						viewportHeight = nextHeight;
						editor.fitZoom(nextWidth, nextHeight);
						editor.panX = 0;
						editor.panY = 0;
					}
				});
				resize.observe(viewportElement);
				finishMetric();
			} catch {
				next.dispose();
				if (!disposed) canvasError = m.studio_canvas_failed();
				finishMetric('error');
			}
		})();
		return () => {
			disposed = true;
			resize?.disconnect();
			mountedAdapter?.dispose();
			if (adapter === mountedAdapter) adapter = null;
			ready = false;
			if (canvasElement === node) canvasElement = undefined;
		};
	}

	function attachViewport(node: HTMLDivElement) {
		viewport = node;
		return () => {
			if (viewport === node) viewport = undefined;
		};
	}

	$effect(() => {
		const document = editor.document;
		const page = editor.activePage;
		if (!adapter || !document || !page) return;
		if (document === canvasOriginDocument) {
			canvasOriginDocument = null;
			adapter.accept(document, page);
			return;
		}
		void adapter.sync(document, page);
	});

	$effect(() => {
		adapter?.setSelection(editor.selectedLayerIDs);
	});

	$effect(() => {
		adapter?.setReadOnly(!editor.canEdit);
	});

	function handleWheel(event: WheelEvent): void {
		if (event.ctrlKey || event.metaKey) {
			event.preventDefault();
			editor.zoom = Math.max(0.1, Math.min(4, editor.zoom * (event.deltaY > 0 ? 0.9 : 1.1)));
			return;
		}
		if (editor.activeTool === 'hand' || event.shiftKey) {
			event.preventDefault();
			editor.panX -= event.deltaX || event.deltaY;
			editor.panY -= event.deltaY;
		}
	}

	function startPan(event: PointerEvent): void {
		if (event.pointerType === 'touch') {
			touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
			if (touchPointers.size === 2) {
				const [first, second] = [...touchPointers.values()];
				pinchStart = {
					distance: Math.hypot(second.x - first.x, second.y - first.y),
					zoom: editor.zoom,
					centerX: (first.x + second.x) / 2,
					centerY: (first.y + second.y) / 2,
					panX: editor.panX,
					panY: editor.panY
				};
				panning = true;
				event.preventDefault();
			}
		}
		if (editor.activeTool !== 'hand' && event.button !== 1 && !event.altKey) return;
		panning = true;
		panStart = {
			x: event.clientX,
			y: event.clientY,
			panX: editor.panX,
			panY: editor.panY
		};
		if (event.currentTarget instanceof HTMLDivElement) {
			event.currentTarget.setPointerCapture(event.pointerId);
		}
	}

	function movePan(event: PointerEvent): void {
		if (event.pointerType === 'touch' && touchPointers.has(event.pointerId)) {
			touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
			if (touchPointers.size >= 2) {
				const [first, second] = [...touchPointers.values()];
				const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
				const centerX = (first.x + second.x) / 2;
				const centerY = (first.y + second.y) / 2;
				editor.zoom = Math.max(
					0.1,
					Math.min(4, pinchStart.zoom * (distance / Math.max(1, pinchStart.distance)))
				);
				editor.panX = pinchStart.panX + centerX - pinchStart.centerX;
				editor.panY = pinchStart.panY + centerY - pinchStart.centerY;
				event.preventDefault();
				return;
			}
		}
		if (!panning) return;
		editor.panX = panStart.panX + event.clientX - panStart.x;
		editor.panY = panStart.panY + event.clientY - panStart.y;
	}

	function stopPan(event: PointerEvent): void {
		if (event.pointerType === 'touch') touchPointers.delete(event.pointerId);
		if (!panning) return;
		panning = false;
		if (
			event.currentTarget instanceof HTMLDivElement &&
			event.currentTarget.hasPointerCapture(event.pointerId)
		) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
	}
</script>

<div
	{@attach attachViewport}
	class="studio-pasteboard relative size-full min-h-0 touch-none overflow-hidden bg-neutral-800 dark:bg-neutral-950"
	class:cursor-grab={editor.activeTool === 'hand' && !panning}
	class:cursor-grabbing={panning}
	onwheel={handleWheel}
	onpointerdown={startPan}
	onpointermove={movePan}
	onpointerup={stopPan}
	onpointercancel={stopPan}
	role="application"
	aria-label={m.studio_design_canvas()}
>
	{#if editor.document}
		<div
			class="absolute top-1/2 left-1/2"
			style:transform={`translate(calc(-50% + ${editor.panX}px), calc(-50% + ${editor.panY}px))`}
		>
			<div
				class="fabric-stage shadow-2xl ring-1 ring-black/30"
				style:width={`${editor.document.width_px * editor.zoom}px`}
				style:height={`${editor.document.height_px * editor.zoom}px`}
				style:--studio-zoom={editor.zoom}
			>
				{#key canvasAttempt}
					<canvas {@attach attachCanvas} aria-hidden="true"></canvas>
				{/key}
			</div>
		</div>
	{/if}
	{#if canvasError}
		<div
			class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-900/80 p-4 text-center text-sm text-neutral-200"
			role="alert"
		>
			<p>{canvasError}</p>
			<Button
				variant="secondary"
				size="sm"
				onclick={() => {
					canvasError = '';
					canvasAttempt += 1;
				}}>{m.common_retry()}</Button
			>
		</div>
	{:else if !ready}
		<div class="absolute inset-0 flex items-center justify-center text-sm text-neutral-300">
			{m.studio_preparing_canvas()}
		</div>
	{/if}
</div>

<style>
	.fabric-stage :global(.canvas-container) {
		transform: scale(var(--studio-zoom));
		transform-origin: top left;
	}
</style>
