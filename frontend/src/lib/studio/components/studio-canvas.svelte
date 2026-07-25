<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { Button } from '$lib/components/ui/button';
	import { Slider } from '$lib/components/ui/slider';
	import { OpenPostFabricAdapter } from '../fabric-adapter';
	import { useStudioEditor } from '../editor.svelte';
	import { m } from '$lib/paraglide/messages';
	import { startStudioMetric } from '../telemetry';
	import {
		normalizeSelectionBounds,
		type SelectionBounds,
		type SelectionPoint
	} from '../selection';
	import type { StudioSelectionMode, StudioSelectionTool } from '../types';

	type AreaSelectionTool = Extract<StudioSelectionTool, 'marquee' | 'lasso'>;
	interface SelectionGesture {
		tool: AreaSelectionTool;
		pointerID: number;
		start: SelectionPoint;
		current: SelectionPoint;
		points: SelectionPoint[];
		mode: StudioSelectionMode;
	}

	const editor = useStudioEditor();
	let canvasElement = $state<HTMLCanvasElement>();
	let viewport = $state<HTMLDivElement>();
	let stageElement = $state<HTMLDivElement>();
	let adapter = $state.raw<OpenPostFabricAdapter | null>(null);
	let canvasOriginDocument = editor.document;
	let ready = $state(false);
	let canvasError = $state('');
	let canvasAttempt = $state(0);
	let panning = $state(false);
	let selectionGesture = $state<SelectionGesture | null>(null);
	let magicPulse = $state<SelectionPoint | null>(null);
	let magicPulseTimer: ReturnType<typeof setTimeout> | undefined;
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

	function attachStage(node: HTMLDivElement) {
		stageElement = node;
		return () => {
			if (stageElement === node) stageElement = undefined;
		};
	}

	onDestroy(() => {
		if (magicPulseTimer) clearTimeout(magicPulseTimer);
	});

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

	$effect(() => {
		adapter?.setInteractionTool(editor.activeTool);
	});

	function isAreaSelectionTool(tool = editor.activeTool): tool is AreaSelectionTool | 'magic_wand' {
		return tool === 'marquee' || tool === 'lasso' || tool === 'magic_wand';
	}

	function selectionModeForEvent(event: PointerEvent): StudioSelectionMode {
		if (event.metaKey || event.ctrlKey) return 'toggle';
		if (event.altKey) return 'subtract';
		if (event.shiftKey) return 'add';
		return editor.selectionMode;
	}

	function documentPoint(event: PointerEvent, clampToCanvas = false): SelectionPoint | null {
		const stage = stageElement;
		const document = editor.document;
		if (!stage || !document) return null;
		const bounds = stage.getBoundingClientRect();
		const x = ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * document.width_px;
		const y = ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * document.height_px;
		if (!clampToCanvas && (x < 0 || y < 0 || x > document.width_px || y > document.height_px)) {
			return null;
		}
		return {
			x: Math.max(0, Math.min(document.width_px, x)),
			y: Math.max(0, Math.min(document.height_px, y))
		};
	}

	function showMagicPulse(point: SelectionPoint): void {
		magicPulse = point;
		if (magicPulseTimer) clearTimeout(magicPulseTimer);
		magicPulseTimer = setTimeout(() => {
			magicPulse = null;
			magicPulseTimer = undefined;
		}, 420);
	}

	function startAreaSelection(event: PointerEvent): boolean {
		const tool = editor.activeTool;
		if (!isAreaSelectionTool(tool) || !adapter || event.button !== 0) return false;
		const point = documentPoint(event);
		if (!point) return false;
		const mode = selectionModeForEvent(event);
		if (tool === 'magic_wand') {
			editor.applyLayerSelection(
				adapter.magicLayerIDsAtPoint(point, editor.magicSelectTolerance),
				mode
			);
			showMagicPulse(point);
			event.preventDefault();
			return true;
		}
		selectionGesture = {
			tool,
			pointerID: event.pointerId,
			start: point,
			current: point,
			points: [point],
			mode
		};
		if (event.currentTarget instanceof HTMLDivElement) {
			event.currentTarget.setPointerCapture(event.pointerId);
		}
		event.preventDefault();
		return true;
	}

	function moveAreaSelection(event: PointerEvent): boolean {
		const gesture = selectionGesture;
		if (!gesture || gesture.pointerID !== event.pointerId) return false;
		const point = documentPoint(event, true);
		if (!point) return false;
		const points =
			gesture.tool === 'lasso' &&
			Math.hypot(
				point.x - (gesture.points.at(-1)?.x ?? point.x),
				point.y - (gesture.points.at(-1)?.y ?? point.y)
			) >=
				3 / Math.max(editor.zoom, 0.1)
				? [...gesture.points, point]
				: gesture.points;
		selectionGesture = { ...gesture, current: point, points };
		event.preventDefault();
		return true;
	}

	function finishAreaSelection(event: PointerEvent): boolean {
		const gesture = selectionGesture;
		if (!gesture || gesture.pointerID !== event.pointerId) return false;
		const point = documentPoint(event, true) ?? gesture.current;
		const distance =
			gesture.tool === 'lasso'
				? Math.max(
						...gesture.points.map((sample) =>
							Math.hypot(sample.x - gesture.start.x, sample.y - gesture.start.y)
						),
						Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y)
					)
				: Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y);
		let ids: string[];
		if (distance < 5 / Math.max(editor.zoom, 0.1)) {
			const hitID = adapter?.topmostLayerIDAtPoint(point);
			ids = hitID ? [hitID] : [];
		} else if (gesture.tool === 'marquee') {
			ids = adapter?.layerIDsInRectangle(normalizeSelectionBounds(gesture.start, point)) ?? [];
		} else {
			const points = [...gesture.points, point];
			ids = points.length >= 3 ? (adapter?.layerIDsInPolygon(points) ?? []) : [];
		}
		editor.applyLayerSelection(ids, gesture.mode);
		selectionGesture = null;
		if (
			event.currentTarget instanceof HTMLDivElement &&
			event.currentTarget.hasPointerCapture(event.pointerId)
		) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		event.preventDefault();
		return true;
	}

	function cancelAreaSelection(event: PointerEvent): void {
		if (selectionGesture?.pointerID === event.pointerId) selectionGesture = null;
		if (
			event.currentTarget instanceof HTMLDivElement &&
			event.currentTarget.hasPointerCapture(event.pointerId)
		) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
	}

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
				selectionGesture = null;
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
				return;
			}
		}
		if (startAreaSelection(event)) return;
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
		if (moveAreaSelection(event)) return;
		if (!panning) return;
		editor.panX = panStart.panX + event.clientX - panStart.x;
		editor.panY = panStart.panY + event.clientY - panStart.y;
	}

	function stopPan(event: PointerEvent): void {
		if (event.pointerType === 'touch') touchPointers.delete(event.pointerId);
		if (finishAreaSelection(event)) return;
		if (!panning) return;
		panning = false;
		if (
			event.currentTarget instanceof HTMLDivElement &&
			event.currentTarget.hasPointerCapture(event.pointerId)
		) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
	}

	function cancelPointer(event: PointerEvent): void {
		if (event.pointerType === 'touch') touchPointers.delete(event.pointerId);
		cancelAreaSelection(event);
		panning = false;
	}

	function marqueeBounds(gesture: SelectionGesture): SelectionBounds {
		return normalizeSelectionBounds(gesture.start, gesture.current);
	}

	function lassoPoints(gesture: SelectionGesture): string {
		return gesture.points.map((point) => `${point.x},${point.y}`).join(' ');
	}
</script>

<div
	{@attach attachViewport}
	class="studio-pasteboard relative size-full min-h-0 touch-none overflow-hidden bg-neutral-800 dark:bg-neutral-950"
	class:cursor-grab={editor.activeTool === 'hand' && !panning}
	class:cursor-grabbing={panning}
	class:cursor-crosshair={isAreaSelectionTool() && !panning}
	onwheel={handleWheel}
	onpointerdowncapture={startPan}
	onpointermovecapture={movePan}
	onpointerupcapture={stopPan}
	onpointercancelcapture={cancelPointer}
	role="application"
	aria-label={m.studio_design_canvas()}
>
	{#if editor.document}
		{#if isAreaSelectionTool()}
			<div
				class="absolute top-3 left-1/2 z-30 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-lg border border-white/10 bg-neutral-950/88 p-1.5 text-neutral-100 shadow-lg backdrop-blur"
				data-testid="studio-selection-options"
			>
				<span class="hidden px-1 text-xs font-medium sm:inline">
					{editor.activeTool === 'marquee'
						? m.studio_rectangle_select()
						: editor.activeTool === 'lasso'
							? m.studio_lasso_select()
							: m.studio_magic_select()}
				</span>
				<div class="flex items-center gap-0.5" role="group" aria-label={m.studio_selection_mode()}>
					{#each [{ value: 'replace', label: m.studio_selection_replace() }, { value: 'add', label: m.studio_selection_add() }, { value: 'subtract', label: m.studio_selection_subtract() }] as mode (mode.value)}
						<Button
							variant={editor.selectionMode === mode.value ? 'secondary' : 'ghost'}
							size="sm"
							class="h-8 px-2 text-xs text-neutral-100 hover:text-foreground [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-11"
							aria-pressed={editor.selectionMode === mode.value}
							onclick={() => (editor.selectionMode = mode.value as StudioSelectionMode)}
						>
							{mode.label}
						</Button>
					{/each}
				</div>
				{#if editor.activeTool === 'magic_wand'}
					<label class="flex min-w-40 items-center gap-2 px-1 text-xs">
						<span class="whitespace-nowrap">
							{m.studio_magic_tolerance({ value: editor.magicSelectTolerance })}
						</span>
						<Slider
							value={editor.magicSelectTolerance}
							min={0}
							max={50}
							step={1}
							class="w-24"
							ariaLabel={m.studio_magic_tolerance({ value: editor.magicSelectTolerance })}
							onValueChange={(value) => (editor.magicSelectTolerance = value)}
						/>
					</label>
				{/if}
			</div>
		{/if}
		<div
			class="absolute top-1/2 left-1/2"
			style:transform={`translate(calc(-50% + ${editor.panX}px), calc(-50% + ${editor.panY}px))`}
		>
			<div
				{@attach attachStage}
				class="fabric-stage relative shadow-2xl ring-1 ring-black/30"
				style:width={`${editor.document.width_px * editor.zoom}px`}
				style:height={`${editor.document.height_px * editor.zoom}px`}
				style:--studio-zoom={editor.zoom}
			>
				{#key canvasAttempt}
					<canvas {@attach attachCanvas} aria-hidden="true"></canvas>
				{/key}
				{#if isAreaSelectionTool()}
					<div
						class="absolute inset-0 z-10 cursor-crosshair touch-none"
						data-testid="studio-selection-surface"
						aria-hidden="true"
					></div>
				{/if}
				{#if selectionGesture}
					<svg
						class="pointer-events-none absolute inset-0 z-20 size-full overflow-visible"
						viewBox={`0 0 ${editor.document.width_px} ${editor.document.height_px}`}
						aria-hidden="true"
					>
						{#if selectionGesture.tool === 'marquee'}
							{@const bounds = marqueeBounds(selectionGesture)}
							<rect
								class="studio-selection-outline"
								x={bounds.x}
								y={bounds.y}
								width={bounds.width}
								height={bounds.height}
							/>
						{:else}
							<polygon class="studio-selection-outline" points={lassoPoints(selectionGesture)} />
						{/if}
					</svg>
				{/if}
				{#if magicPulse}
					<svg
						class="pointer-events-none absolute inset-0 z-20 size-full overflow-visible"
						viewBox={`0 0 ${editor.document.width_px} ${editor.document.height_px}`}
						aria-hidden="true"
					>
						<circle
							class="studio-magic-pulse"
							cx={magicPulse.x}
							cy={magicPulse.y}
							r={18 / Math.max(editor.zoom, 0.1)}
						/>
					</svg>
				{/if}
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

	.studio-selection-outline {
		fill: rgb(249 115 22 / 0.12);
		stroke: #fb923c;
		stroke-width: calc(1.5 / var(--studio-zoom));
		stroke-dasharray: calc(7 / var(--studio-zoom)) calc(5 / var(--studio-zoom));
		vector-effect: non-scaling-stroke;
		animation: studio-selection-march 0.65s linear infinite;
	}

	.studio-magic-pulse {
		fill: rgb(249 115 22 / 0.14);
		stroke: #fb923c;
		stroke-width: 2;
		vector-effect: non-scaling-stroke;
		animation: studio-magic-pulse 0.42s ease-out forwards;
	}

	@keyframes studio-selection-march {
		to {
			stroke-dashoffset: -12;
		}
	}

	@keyframes studio-magic-pulse {
		from {
			opacity: 1;
			transform: scale(0.35);
			transform-origin: center;
		}
		to {
			opacity: 0;
			transform: scale(1.65);
			transform-origin: center;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.studio-selection-outline,
		.studio-magic-pulse {
			animation: none;
		}
	}
</style>
