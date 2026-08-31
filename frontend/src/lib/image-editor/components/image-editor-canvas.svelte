<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { Button } from '$lib/components/ui/button';
	import { Slider } from '$lib/components/ui/slider';
	import FlipHorizontalIcon from '@lucide/svelte/icons/flip-horizontal-2';
	import FlipVerticalIcon from '@lucide/svelte/icons/flip-vertical-2';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import AppSelect from '$lib/components/app-select.svelte';
	import { OpenPostFabricAdapter, type ImageEditorPixelGrid } from '../fabric-adapter';
	import { useImageEditor } from '../editor.svelte';
	import PaintColorControls from './paint-color-controls.svelte';
	import { m } from '$lib/paraglide/messages';
	import { startImageEditorMetric } from '../telemetry';
	import {
		ellipsePixelMask,
		intersectPixelMasks,
		normalizeSelectionBounds,
		pixelMaskContainsPoint,
		polygonPixelMask,
		rectanglePixelMask,
		type SelectionBounds,
		type SelectionPoint
	} from '../selection';
	import type {
		ImageEditorGradientType,
		ImageEditorColorTarget,
		ImageEditorSelectionMode,
		ImageEditorSelectionTool
	} from '../types';
	import {
		containsExternalImageDrag,
		containsImageEditorMediaDrag,
		externalFiles,
		readImageEditorMediaDrag,
		IMAGE_EDITOR_MEDIA_DRAG_TYPE
	} from '../media-drag';
	import { imageEditorDocumentPoint, panForZoomAnchor } from '../viewport';
	import { ImageEditorMagicScan, MAXIMUM_MAGIC_SCAN_PIXELS } from '../magic-scan';
	import {
		applyImageEditorCropWindow,
		imageEditorCropWindowForAspect,
		normalizeImageEditorCropWindow,
		resetImageEditorCrop,
		type ImageEditorCropWindow
	} from '../crop';
	import type { ImageEditorLayer } from '../types';

	let {
		onExternalFiles,
		registerPixelSelectionActions,
		onMissingMedia
	}: {
		onExternalFiles?: (
			files: File[],
			point: SelectionPoint,
			pageID: string
		) => void | Promise<void>;
		registerPixelSelectionActions?: (actions: PixelSelectionActions | null) => void;
		onMissingMedia?: (mediaID: string, layerID?: string) => void;
	} = $props();

	interface PixelSelectionActions {
		copy(): ImageEditorLayer[];
		begin(mode: 'promote' | 'cut'): boolean;
		delete(): boolean;
	}

	type AreaSelectionTool = Extract<
		ImageEditorSelectionTool,
		'marquee' | 'ellipse_marquee' | 'lasso'
	>;
	type CanvasGestureTool = AreaSelectionTool | 'select' | 'pencil' | 'eraser' | 'gradient';
	interface SelectionGesture {
		tool: CanvasGestureTool;
		pointerID: number;
		start: SelectionPoint;
		current: SelectionPoint;
		points: SelectionPoint[];
		mode: ImageEditorSelectionMode;
		targetLayerID?: string;
		originalSelection?: Uint8Array;
	}

	const editor = useImageEditor();
	const magicScan = new ImageEditorMagicScan();
	const GRID_BACKGROUND_IMAGE =
		'linear-gradient(to right, rgb(249 115 22 / 0.22) 1px, transparent 1px), linear-gradient(to bottom, rgb(249 115 22 / 0.22) 1px, transparent 1px)';
	let canvasElement = $state<HTMLCanvasElement>();
	let viewport = $state<HTMLDivElement>();
	let stageElement = $state<HTMLDivElement>();
	let adapter = $state.raw<OpenPostFabricAdapter | null>(null);
	let canvasOriginDocument = editor.document;
	let ready = $state(false);
	let canvasError = $state('');
	let canvasAttempt = $state(0);
	let textEditing = false;
	let spacePressed = $state(false);
	let lastAutoEditingLayerID = '';
	let panning = $state(false);
	let selectionGesture = $state<SelectionGesture | null>(null);
	let magicPulse = $state<SelectionPoint | null>(null);
	let eyedropperPreview = $state.raw<{
		point: SelectionPoint;
		color: string;
		alpha: number;
		grid: ImageEditorPixelGrid;
	} | null>(null);
	let eyedropperKeyboardCursor = $state.raw<SelectionPoint | null>(null);
	let brushPreview = $state.raw<SelectionPoint | null>(null);
	let cursorPoint = $state.raw<SelectionPoint | null>(null);
	let guideGesture = $state.raw<{
		pointerID: number;
		axis: 'horizontal' | 'vertical';
		index?: number;
		value: number;
	} | null>(null);
	let canvasAnnouncement = $state('');
	let selectionOverlay = $state<HTMLCanvasElement>();
	let magicPulseTimer: ReturnType<typeof setTimeout> | undefined;
	let eyedropperFrame: number | undefined;
	let pendingEyedropperPoint: SelectionPoint | null = null;
	let eyedropperPointerID = -1;
	let stylusPointerID = -1;
	let mediaDropActive = $state(false);
	let layerPicker = $state.raw<{ point: SelectionPoint; layerIDs: string[] } | null>(null);
	let layerCycleGesture = $state.raw<{
		pointerID: number;
		clientX: number;
		clientY: number;
		layerIDs: string[];
	} | null>(null);
	let magicScanBusy = $state(false);
	let magicScanProgress = $state(0);
	let magicScanError = $state('');
	let magicScanAbort: AbortController | null = null;
	let magicPreviewMask = $state.raw<{ width: number; height: number; data: Uint8Array } | null>(
		null
	);
	type FloatingTransformHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'rotate';
	let floatingTransformGesture = $state.raw<{
		pointerID: number;
		handle: FloatingTransformHandle;
		point: SelectionPoint;
	} | null>(null);
	const FULL_CROP_WINDOW: ImageEditorCropWindow = { x: 0, y: 0, width: 1, height: 1 };
	let cropWindow = $state.raw<ImageEditorCropWindow>({ ...FULL_CROP_WINDOW });
	let cropSourceWindow = $state.raw<ImageEditorCropWindow>({ ...FULL_CROP_WINDOW });
	let cropAspect = $state('free');
	let cropMode = $state<'frame' | 'content'>('frame');
	let cropRotationDelta = $state(0);
	let cropFlipX = $state(false);
	let cropFlipY = $state(false);
	let cropBaseLayer = $state.raw<ImageEditorLayer | null>(null);
	let cropGesture = $state.raw<{
		pointerID: number;
		handle: CropHandle;
		start: SelectionPoint;
		origin: ImageEditorCropWindow;
		sourceOrigin: ImageEditorCropWindow;
	} | null>(null);
	let mediaDragDepth = 0;
	let panStart = { x: 0, y: 0, panX: 0, panY: 0 };
	const touchPointers = new SvelteMap<number, { x: number; y: number }>();
	let pinchStart = { distance: 0, zoom: 1, centerX: 0, centerY: 0, panX: 0, panY: 0 };
	type CropHandle = 'move' | 'content' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

	let cropLayer = $derived(
		editor.activeTool === 'crop'
			? (editor.selectedLayers.find((layer) => layer.type === 'image' && !layer.locked) ?? null)
			: null
	);
	let cropPreviewLayer = $derived.by(() => createCropPreviewLayer());

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
			const finishMetric = startImageEditorMetric('canvas_ready');
			const next = new OpenPostFabricAdapter({
				canvas: node,
				document: editor.document,
				page: editor.activePage,
				readOnly: !editor.canEdit,
				onSelection(ids) {
					editor.selectedLayerIDs = ids;
				},
				onTransform(id, updates) {
					editor.updateTransform(id, updates, '');
				},
				onAltDuplicate(entries) {
					editor.duplicateSelectedAtTransforms(entries);
				},
				onTextChange(id, text) {
					const layer = editor.activePage?.layers.find((item) => item.id === id);
					if (!layer?.text || layer.text.text === text) return;
					editor.updateLayer(id, { text: { ...layer.text, text } }, `text:${id}`);
					canvasOriginDocument = editor.document;
				},
				onTextEditingChange(editing) {
					textEditing = editing;
				},
				onImageDimensions(id, width, height) {
					editor.resolveImageDimensions(id, width, height);
				},
				onMissingMedia(mediaID, layerID) {
					onMissingMedia?.(mediaID, layerID);
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
				editor.setViewportSize(viewportElement.clientWidth, viewportElement.clientHeight);
				editor.fitZoom();
				ready = true;
				let viewportWidth = viewportElement.clientWidth;
				let viewportHeight = viewportElement.clientHeight;
				resize = new ResizeObserver(() => {
					if (textEditing) return;
					const nextWidth = viewportElement.clientWidth;
					const nextHeight = viewportElement.clientHeight;
					editor.setViewportSize(nextWidth, nextHeight);
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
				if (!disposed) canvasError = m.image_editor_canvas_failed();
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

	function capturePointer(target: EventTarget | null, pointerID: number): void {
		if (!(target instanceof Element)) return;
		try {
			target.setPointerCapture(pointerID);
		} catch {
			// Synthetic tests and interrupted OS gestures may no longer own the pointer.
			// Window/capture handlers still finish or cancel the transient edit safely.
		}
	}

	function attachStage(node: HTMLDivElement) {
		stageElement = node;
		return () => {
			if (stageElement === node) stageElement = undefined;
		};
	}

	function attachSelectionOverlay(node: HTMLCanvasElement) {
		selectionOverlay = node;
		return () => {
			if (selectionOverlay === node) selectionOverlay = undefined;
		};
	}

	onDestroy(() => {
		if (magicPulseTimer) clearTimeout(magicPulseTimer);
		if (eyedropperFrame !== undefined) cancelAnimationFrame(eyedropperFrame);
		magicScanAbort?.abort();
		magicScan.dispose();
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
		if (editor.activeTool === 'eyedropper') return;
		eyedropperKeyboardCursor = null;
		eyedropperPreview = null;
	});

	$effect(() => {
		const sessionID = cropBaseLayer?.id;
		const activeID = cropLayer?.id;
		if (!sessionID || (editor.activeTool === 'crop' && activeID === sessionID)) return;
		adapter?.previewImageLayer(sessionID);
		resetCropSessionState();
	});

	$effect(() => {
		const id = editor.activeTool === 'text' ? editor.selectedLayerIDs.at(-1) : '';
		const layer = editor.activePage?.layers.find((item) => item.id === id);
		if (!id || layer?.type !== 'text') {
			lastAutoEditingLayerID = '';
			return;
		}
		if (id === lastAutoEditingLayerID) return;
		lastAutoEditingLayerID = id;
		adapter?.enterTextEditing(id);
	});

	$effect(() => {
		adapter?.setReadOnly(!editor.canEdit);
	});

	$effect(() => {
		adapter?.setInteractionTool(editor.activeTool);
	});

	$effect(() => {
		adapter?.setSnapping(editor.snappingEnabled);
	});

	$effect(() => {
		adapter?.setPrecisionSnapSources(
			editor.showGuides ? editor.activePage?.guides : undefined,
			editor.snapToGrid ? editor.gridSize : 0
		);
	});

	$effect(() => {
		const selection = magicPreviewMask ?? editor.pixelSelection;
		const canvas = selectionOverlay;
		if (!canvas || !editor.document) return;
		const context = canvas.getContext('2d');
		if (!context) return;
		context.clearRect(0, 0, canvas.width, canvas.height);
		if (!selection) return;
		const image = context.createImageData(selection.width, selection.height);
		for (let index = 0; index < selection.data.length; index++) {
			if (!selection.data[index]) continue;
			const x = index % selection.width;
			const y = Math.floor(index / selection.width);
			const edge =
				x === 0 ||
				y === 0 ||
				x + 1 === selection.width ||
				y + 1 === selection.height ||
				!selection.data[index - 1] ||
				!selection.data[index + 1] ||
				!selection.data[index - selection.width] ||
				!selection.data[index + selection.width];
			const offset = index * 4;
			const light = (x + y) % 8 < 4;
			image.data[offset] = light ? 255 : 0;
			image.data[offset + 1] = light ? 255 : 0;
			image.data[offset + 2] = light ? 255 : 0;
			image.data[offset + 3] = edge ? 235 : 0;
		}
		context.putImageData(image, 0, 0);
	});

	function isAreaSelectionTool(tool = editor.activeTool): tool is AreaSelectionTool | 'magic_wand' {
		return (
			tool === 'marquee' || tool === 'ellipse_marquee' || tool === 'lasso' || tool === 'magic_wand'
		);
	}

	function isDragSelectionTool(tool = editor.activeTool): tool is AreaSelectionTool {
		return tool === 'marquee' || tool === 'ellipse_marquee' || tool === 'lasso';
	}

	function usesCanvasSurface(): boolean {
		return (
			isAreaSelectionTool() ||
			editor.activeTool === 'pencil' ||
			editor.activeTool === 'eraser' ||
			editor.activeTool === 'magic_eraser' ||
			editor.activeTool === 'bucket' ||
			editor.activeTool === 'gradient' ||
			editor.activeTool === 'eyedropper'
		);
	}

	function sampleEyedropper(point: SelectionPoint, commit: boolean): boolean {
		if (!adapter) return false;
		const activeID = editor.selectedLayerIDs.at(-1);
		const grid =
			editor.sampleAllLayers || !activeID
				? adapter.samplePagePixelGrid(point)
				: adapter.sampleLayerPixelGrid(activeID, point);
		if (!grid) return false;
		const pixel = grid.centerPixel;
		const color = `#${[pixel[0], pixel[1], pixel[2]]
			.map((channel) => channel.toString(16).padStart(2, '0'))
			.join('')}`;
		const alpha = pixel[3] ?? 0;
		eyedropperPreview = { point, color, alpha, grid };
		if (commit) {
			editor.applySampledColor(color, alpha);
			canvasAnnouncement = m.image_editor_sampled_color_at_point({
				color: color.toUpperCase(),
				x: Math.floor(point.x),
				y: Math.floor(point.y)
			});
		}
		return true;
	}

	function queueEyedropperSample(point: SelectionPoint): void {
		pendingEyedropperPoint = point;
		if (eyedropperFrame !== undefined) return;
		eyedropperFrame = requestAnimationFrame(() => {
			eyedropperFrame = undefined;
			const pending = pendingEyedropperPoint;
			pendingEyedropperPoint = null;
			if (pending) sampleEyedropper(pending, false);
		});
	}

	function moveEyedropperCursor(event: KeyboardEvent): boolean {
		if (
			editor.activeTool !== 'eyedropper' ||
			!editor.document ||
			!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
		)
			return false;
		const current = eyedropperKeyboardCursor ??
			eyedropperPreview?.point ??
			cursorPoint ?? {
				x: Math.floor(editor.document.width_px / 2),
				y: Math.floor(editor.document.height_px / 2)
			};
		const step = event.shiftKey ? 10 : 1;
		const point = {
			x: Math.max(
				0,
				Math.min(
					editor.document.width_px - 1,
					current.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0)
				)
			),
			y: Math.max(
				0,
				Math.min(
					editor.document.height_px - 1,
					current.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0)
				)
			)
		};
		eyedropperKeyboardCursor = point;
		sampleEyedropper(point, false);
		return true;
	}

	function eyedropperPixelColor(grid: ImageEditorPixelGrid, index: number): string {
		const offset = index * 4;
		return `rgba(${grid.data[offset] ?? 0}, ${grid.data[offset + 1] ?? 0}, ${grid.data[offset + 2] ?? 0}, ${(grid.data[offset + 3] ?? 0) / 255})`;
	}

	function eyedropperMagnifierOffset(point: SelectionPoint): SelectionPoint {
		const document = editor.document;
		if (!document) return { x: 14, y: 14 };
		return {
			x: point.x > document.width_px / 2 ? -78 : 14,
			y: point.y > document.height_px / 2 ? -78 : 14
		};
	}

	function pixelContentProjections(): Array<{
		id: string;
		width: number;
		height: number;
		data: Uint8Array;
	}> {
		const selection = editor.pixelSelection;
		if (!selection || !adapter || !editor.document) return [];
		const targetIDs =
			selection.targetLayerIDs.length > 0
				? selection.targetLayerIDs
				: editor.selectedLayerIDs.slice(-1);
		return targetIDs
			.map((id) => {
				const projected = adapter?.projectPixelMaskToLayer(
					id,
					selection.data,
					selection.width,
					selection.height
				);
				return projected ? { id, ...projected } : null;
			})
			.filter(
				(
					projection
				): projection is { id: string; width: number; height: number; data: Uint8Array } =>
					Boolean(projection)
			);
	}

	function commitPixelContent(mode: 'promote' | 'cut' | 'delete'): boolean {
		const projections = pixelContentProjections();
		const changed =
			mode === 'delete'
				? editor.commitPixelSelectionContent(mode, projections)
				: editor.beginFloatingPixelSelection(mode, projections);
		if (changed) {
			canvasAnnouncement =
				mode === 'delete'
					? m.image_editor_selected_pixels_deleted()
					: m.image_editor_floating_pixels_help();
		}
		return changed;
	}

	function commitFloatingPixels(): boolean {
		const changed = editor.commitFloatingPixelSelection();
		if (changed) canvasAnnouncement = m.image_editor_selected_pixels_applied();
		return changed;
	}

	function cancelFloatingPixels(): boolean {
		const changed = editor.cancelFloatingPixelSelection();
		if (changed) canvasAnnouncement = m.image_editor_floating_pixels_cancelled();
		return changed;
	}

	function deleteFloatingPixels(): boolean {
		const changed = editor.deleteFloatingPixelSelection();
		if (changed) canvasAnnouncement = m.image_editor_selected_pixels_deleted();
		return changed;
	}

	function startFloatingTransform(event: PointerEvent, handle: FloatingTransformHandle): void {
		if (!editor.floatingPixelSelection || event.button !== 0) return;
		const point = documentPoint(event, 'allow');
		if (!point) return;
		floatingTransformGesture = { pointerID: event.pointerId, handle, point };
		capturePointer(event.currentTarget, event.pointerId);
		event.preventDefault();
		event.stopPropagation();
	}

	function applyFloatingTransformDelta(
		handle: FloatingTransformHandle,
		start: SelectionPoint,
		point: SelectionPoint,
		constrain = false
	): boolean {
		const bounds = editor.floatingPixelSelectionBounds;
		if (!bounds) return false;
		const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
		if (handle === 'rotate') {
			const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
			const nextAngle = Math.atan2(point.y - center.y, point.x - center.x);
			let degrees = ((nextAngle - startAngle) * 180) / Math.PI;
			if (constrain) degrees = Math.round(degrees / 15) * 15;
			return editor.transformFloatingPixelSelection(center, 1, 1, degrees);
		}
		const deltaX = point.x - start.x;
		const deltaY = point.y - start.y;
		let scaleX = 1;
		let scaleY = 1;
		let anchorX = center.x;
		let anchorY = center.y;
		if (handle.includes('e')) {
			scaleX = Math.max(1 / Math.max(1, bounds.width), (bounds.width + deltaX) / bounds.width);
			anchorX = bounds.x;
		} else if (handle.includes('w')) {
			scaleX = Math.max(1 / Math.max(1, bounds.width), (bounds.width - deltaX) / bounds.width);
			anchorX = bounds.x + bounds.width;
		}
		if (handle.includes('s')) {
			scaleY = Math.max(1 / Math.max(1, bounds.height), (bounds.height + deltaY) / bounds.height);
			anchorY = bounds.y;
		} else if (handle.includes('n')) {
			scaleY = Math.max(1 / Math.max(1, bounds.height), (bounds.height - deltaY) / bounds.height);
			anchorY = bounds.y + bounds.height;
		}
		if (constrain && handle.length === 2) {
			const uniform = Math.max(scaleX, scaleY);
			scaleX = uniform;
			scaleY = uniform;
		}
		return editor.transformFloatingPixelSelection({ x: anchorX, y: anchorY }, scaleX, scaleY);
	}

	function moveFloatingTransform(event: PointerEvent): void {
		const gesture = floatingTransformGesture;
		if (!gesture || gesture.pointerID !== event.pointerId) return;
		const point = documentPoint(event, 'allow');
		if (!point) return;
		if (applyFloatingTransformDelta(gesture.handle, gesture.point, point, event.shiftKey)) {
			floatingTransformGesture = { ...gesture, point };
		}
		event.preventDefault();
		event.stopPropagation();
	}

	function finishFloatingTransform(event: PointerEvent): void {
		if (!floatingTransformGesture || floatingTransformGesture.pointerID !== event.pointerId) return;
		floatingTransformGesture = null;
		editor.finishFloatingPixelSelectionMove();
		if (
			event.currentTarget instanceof Element &&
			event.currentTarget.hasPointerCapture(event.pointerId)
		) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		event.preventDefault();
		event.stopPropagation();
	}

	function nudgeFloatingTransform(event: KeyboardEvent, handle: FloatingTransformHandle): void {
		if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
		event.preventDefault();
		event.stopPropagation();
		const step = event.shiftKey ? 10 : 1;
		if (handle === 'rotate') {
			const direction = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1;
			const bounds = editor.floatingPixelSelectionBounds;
			if (bounds) {
				editor.transformFloatingPixelSelection(
					{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
					1,
					1,
					direction * step
				);
				editor.finishFloatingPixelSelectionMove();
			}
			return;
		}
		applyFloatingTransformDelta(
			handle,
			{ x: 0, y: 0 },
			{
				x: event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
				y: event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
			}
		);
		editor.finishFloatingPixelSelectionMove();
	}

	const pixelSelectionActions: PixelSelectionActions = {
		copy: () => editor.extractPixelSelectionLayers(pixelContentProjections()),
		begin: (mode) => commitPixelContent(mode),
		delete: () => commitPixelContent('delete')
	};

	$effect(() => {
		registerPixelSelectionActions?.(pixelSelectionActions);
		return () => registerPixelSelectionActions?.(null);
	});

	function cropSessionLayer(): ImageEditorLayer | null {
		if (!cropLayer?.image) return null;
		return cropBaseLayer?.id === cropLayer.id ? cropBaseLayer : cropLayer;
	}

	function ensureCropSession(): ImageEditorLayer | null {
		if (!cropLayer?.image) return null;
		if (cropBaseLayer?.id === cropLayer.id) return cropBaseLayer;
		if (cropBaseLayer) adapter?.previewImageLayer(cropBaseLayer.id);
		resetCropSessionState();
		cropBaseLayer = structuredClone(cropLayer);
		return cropBaseLayer;
	}

	function normalizeRotation(rotation: number): number {
		const normalized = ((((rotation + 180) % 360) + 360) % 360) - 180;
		return Object.is(normalized, -0) ? 0 : normalized;
	}

	function createCropPreviewLayer(): ImageEditorLayer | null {
		const base = cropSessionLayer();
		if (!base?.image) return null;
		const result = applyImageEditorCropWindow(base, cropWindow, cropSourceWindow);
		return {
			...structuredClone(base),
			transform: {
				...result.transform,
				rotation: normalizeRotation(base.transform.rotation + cropRotationDelta),
				flip_x: base.transform.flip_x !== cropFlipX,
				flip_y: base.transform.flip_y !== cropFlipY
			},
			image: { ...structuredClone(base.image), crop: result.crop }
		};
	}

	function previewCrop(): void {
		const preview = createCropPreviewLayer();
		if (preview) adapter?.previewImageLayer(preview.id, preview);
	}

	function resetCropSessionState(): void {
		cropGesture = null;
		cropWindow = { ...FULL_CROP_WINDOW };
		cropSourceWindow = { ...FULL_CROP_WINDOW };
		cropAspect = 'free';
		cropMode = 'frame';
		cropRotationDelta = 0;
		cropFlipX = false;
		cropFlipY = false;
		cropBaseLayer = null;
	}

	function cropPointDelta(start: SelectionPoint, current: SelectionPoint): SelectionPoint {
		const base = cropSessionLayer();
		const preview = createCropPreviewLayer();
		if (!base || !preview) return { x: 0, y: 0 };
		const deltaX = current.x - start.x;
		const deltaY = current.y - start.y;
		const radians = (-preview.transform.rotation * Math.PI) / 180;
		return {
			x:
				(deltaX * Math.cos(radians) - deltaY * Math.sin(radians)) /
				Math.max(1, base.transform.width),
			y:
				(deltaX * Math.sin(radians) + deltaY * Math.cos(radians)) /
				Math.max(1, base.transform.height)
		};
	}

	function updateCropWindow(
		origin: ImageEditorCropWindow,
		handle: CropHandle,
		delta: SelectionPoint
	): ImageEditorCropWindow {
		if (handle === 'move') {
			return {
				...origin,
				x: Math.max(0, Math.min(1 - origin.width, origin.x + delta.x)),
				y: Math.max(0, Math.min(1 - origin.height, origin.y + delta.y))
			};
		}
		let left = origin.x;
		let top = origin.y;
		let right = origin.x + origin.width;
		let bottom = origin.y + origin.height;
		if (handle.includes('w')) left += delta.x;
		if (handle.includes('e')) right += delta.x;
		if (handle.includes('n')) top += delta.y;
		if (handle.includes('s')) bottom += delta.y;
		const minimum = 0.005;
		left = Math.max(0, Math.min(right - minimum, left));
		top = Math.max(0, Math.min(bottom - minimum, top));
		right = Math.min(1, Math.max(left + minimum, right));
		bottom = Math.min(1, Math.max(top + minimum, bottom));
		return normalizeImageEditorCropWindow({
			x: left,
			y: top,
			width: right - left,
			height: bottom - top
		});
	}

	function snapCropWindow(
		window: ImageEditorCropWindow,
		handle: Exclude<CropHandle, 'content'>,
		event: Pick<PointerEvent, 'ctrlKey' | 'metaKey'>
	): ImageEditorCropWindow {
		const base = cropSessionLayer();
		if (!base || !editor.snappingEnabled || event.ctrlKey || event.metaKey) {
			adapter?.clearSnappingGuides();
			return window;
		}
		const result = applyImageEditorCropWindow(base, window, window);
		const rotation = normalizeRotation(base.transform.rotation + cropRotationDelta);
		const quarterTurns = Math.round(rotation / 90);
		if (Math.abs(rotation - quarterTurns * 90) > 0.01) {
			adapter?.clearSnappingGuides();
			return window;
		}
		const transform = { ...result.transform, rotation };
		const local = {
			x: handle.includes('w') ? 0 : handle.includes('e') ? transform.width : transform.width / 2,
			y: handle.includes('n') ? 0 : handle.includes('s') ? transform.height : transform.height / 2
		};
		const radians = (rotation * Math.PI) / 180;
		const center = {
			x: transform.x + transform.width / 2,
			y: transform.y + transform.height / 2
		};
		const point = {
			x:
				center.x +
				(local.x - transform.width / 2) * Math.cos(radians) -
				(local.y - transform.height / 2) * Math.sin(radians),
			y:
				center.y +
				(local.x - transform.width / 2) * Math.sin(radians) +
				(local.y - transform.height / 2) * Math.cos(radians)
		};
		const rotatedSide = Math.abs(quarterTurns) % 2 === 1;
		const axes =
			handle === 'move' || handle.length === 2
				? 'both'
				: handle === 'e' || handle === 'w'
					? rotatedSide
						? 'y'
						: 'x'
					: rotatedSide
						? 'x'
						: 'y';
		const snapped = adapter?.snapDocumentPoint(point, {
			axes,
			excludeLayerIDs: [base.id]
		});
		if (!snapped || (snapped.guideX === null && snapped.guideY === null)) return window;
		const worldDelta = {
			x: snapped.point.x - point.x,
			y: snapped.point.y - point.y
		};
		const localDelta = {
			x:
				(worldDelta.x * Math.cos(-radians) - worldDelta.y * Math.sin(-radians)) /
				Math.max(1, base.transform.width),
			y:
				(worldDelta.x * Math.sin(-radians) + worldDelta.y * Math.cos(-radians)) /
				Math.max(1, base.transform.height)
		};
		return updateCropWindow(window, handle, localDelta);
	}

	function sourceWindowForFrame(
		originFrame: ImageEditorCropWindow,
		originSource: ImageEditorCropWindow,
		nextFrame: ImageEditorCropWindow
	): ImageEditorCropWindow {
		return {
			x: Math.max(0, Math.min(1 - nextFrame.width, nextFrame.x + originSource.x - originFrame.x)),
			y: Math.max(0, Math.min(1 - nextFrame.height, nextFrame.y + originSource.y - originFrame.y)),
			width: nextFrame.width,
			height: nextFrame.height
		};
	}

	function moveCropSource(
		origin: ImageEditorCropWindow,
		delta: SelectionPoint
	): ImageEditorCropWindow {
		const preview = createCropPreviewLayer();
		const horizontal = preview?.transform.flip_x ? delta.x : -delta.x;
		const vertical = preview?.transform.flip_y ? delta.y : -delta.y;
		return {
			...origin,
			x: Math.max(0, Math.min(1 - origin.width, origin.x + horizontal)),
			y: Math.max(0, Math.min(1 - origin.height, origin.y + vertical))
		};
	}

	function startCrop(event: PointerEvent, handle: CropHandle): void {
		const point = documentPoint(event, 'allow');
		if (!point || !ensureCropSession() || event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		cropGesture = {
			pointerID: event.pointerId,
			handle,
			start: point,
			origin: { ...cropWindow },
			sourceOrigin: { ...cropSourceWindow }
		};
		capturePointer(event.currentTarget, event.pointerId);
	}

	function moveCrop(event: PointerEvent): void {
		if (!cropGesture || cropGesture.pointerID !== event.pointerId || !cropSessionLayer()) return;
		const point = documentPoint(event, 'allow');
		if (!point) return;
		const delta = cropPointDelta(cropGesture.start, point);
		if (cropGesture.handle === 'content') {
			adapter?.clearSnappingGuides();
			cropSourceWindow = moveCropSource(cropGesture.sourceOrigin, delta);
		} else {
			const unsnappedWindow = updateCropWindow(cropGesture.origin, cropGesture.handle, delta);
			const nextWindow = snapCropWindow(unsnappedWindow, cropGesture.handle, event);
			cropSourceWindow = sourceWindowForFrame(
				cropGesture.origin,
				cropGesture.sourceOrigin,
				nextWindow
			);
			cropWindow = nextWindow;
			cropAspect = 'free';
		}
		previewCrop();
		event.preventDefault();
		event.stopPropagation();
	}

	function stopCrop(event: PointerEvent): void {
		if (!cropGesture || cropGesture.pointerID !== event.pointerId) return;
		cropGesture = null;
		adapter?.clearSnappingGuides();
		if (
			event.currentTarget instanceof HTMLElement &&
			event.currentTarget.hasPointerCapture(event.pointerId)
		) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		event.preventDefault();
		event.stopPropagation();
	}

	function nudgeCrop(event: KeyboardEvent, handle: CropHandle): void {
		const base = ensureCropSession();
		if (!base || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
		event.preventDefault();
		event.stopPropagation();
		const pixels = event.shiftKey ? 10 : 1;
		const delta = {
			x:
				event.key === 'ArrowLeft'
					? -pixels / Math.max(1, base.transform.width)
					: event.key === 'ArrowRight'
						? pixels / Math.max(1, base.transform.width)
						: 0,
			y:
				event.key === 'ArrowUp'
					? -pixels / Math.max(1, base.transform.height)
					: event.key === 'ArrowDown'
						? pixels / Math.max(1, base.transform.height)
						: 0
		};
		if (handle === 'content') {
			cropSourceWindow = moveCropSource(cropSourceWindow, delta);
		} else {
			const nextWindow = updateCropWindow(cropWindow, handle, delta);
			cropSourceWindow = sourceWindowForFrame(cropWindow, cropSourceWindow, nextWindow);
			cropWindow = nextWindow;
			cropAspect = 'free';
		}
		previewCrop();
	}

	function setCropAspect(value: string): void {
		cropAspect = value;
		const base = ensureCropSession();
		if (!base?.image || value === 'free') return;
		const aspect =
			value === 'original'
				? base.image.source_width / Math.max(1, base.image.source_height)
				: Number(value);
		const nextWindow = imageEditorCropWindowForAspect(base.transform, aspect);
		cropSourceWindow = sourceWindowForFrame(cropWindow, cropSourceWindow, nextWindow);
		cropWindow = nextWindow;
		previewCrop();
	}

	function setCropMode(mode: 'frame' | 'content'): void {
		if (!ensureCropSession()) return;
		cropMode = mode;
		canvasAnnouncement =
			mode === 'frame'
				? m.image_editor_crop_frame_mode_help()
				: m.image_editor_crop_content_mode_help();
	}

	function rotateCrop(delta: -90 | 90): void {
		if (!ensureCropSession()) return;
		cropRotationDelta = normalizeRotation(cropRotationDelta + delta);
		previewCrop();
		canvasAnnouncement =
			delta < 0 ? m.image_editor_crop_rotated_left() : m.image_editor_crop_rotated_right();
	}

	function flipCrop(axis: 'x' | 'y'): void {
		if (!ensureCropSession()) return;
		if (axis === 'x') cropFlipX = !cropFlipX;
		else cropFlipY = !cropFlipY;
		previewCrop();
		canvasAnnouncement =
			axis === 'x'
				? m.image_editor_crop_flipped_horizontal()
				: m.image_editor_crop_flipped_vertical();
	}

	function applyCrop(): void {
		const preview = createCropPreviewLayer();
		if (!preview?.image) return;
		canvasAnnouncement = m.image_editor_crop_applied_dimensions({
			width: Math.max(1, Math.round(preview.transform.width)),
			height: Math.max(1, Math.round(preview.transform.height))
		});
		editor.applyImageCropState(preview.id, {
			transform: preview.transform,
			crop: preview.image.crop
		});
		resetCropSessionState();
		editor.activeTool = 'select';
	}

	function cancelCrop(): void {
		const id = cropBaseLayer?.id ?? cropLayer?.id;
		if (id) adapter?.previewImageLayer(id);
		resetCropSessionState();
		canvasAnnouncement = m.image_editor_crop_cancelled();
		editor.activeTool = 'select';
	}

	function resetCrop(): void {
		if (!cropLayer?.image) return;
		const reset = resetImageEditorCrop(cropLayer);
		cropBaseLayer = {
			...structuredClone(cropLayer),
			transform: reset.transform,
			image: { ...structuredClone(cropLayer.image), crop: reset.crop }
		};
		cropWindow = { ...FULL_CROP_WINDOW };
		cropSourceWindow = { ...FULL_CROP_WINDOW };
		cropAspect = 'free';
		cropMode = 'frame';
		cropRotationDelta = 0;
		cropFlipX = false;
		cropFlipY = false;
		previewCrop();
		canvasAnnouncement = m.image_editor_crop_reset_pending();
	}

	function erasableTargetID(point: SelectionPoint): string | null {
		const selectedID = editor.selectedLayerIDs.at(-1);
		const selected = editor.activePage?.layers.find((layer) => layer.id === selectedID);
		if (selected && ['image', 'paint'].includes(selected.type) && !selected.locked)
			return selected.id;
		const hitID = adapter?.topmostLayerIDAtPoint(point);
		const hit = editor.activePage?.layers.find((layer) => layer.id === hitID);
		if (!hit || !['image', 'paint'].includes(hit.type) || hit.locked) return null;
		editor.selectLayer(hit.id);
		return hit.id;
	}

	function selectionModeForEvent(
		event: PointerEvent,
		tool: ImageEditorSelectionTool
	): ImageEditorSelectionMode {
		if (event.shiftKey && event.altKey) return 'intersect';
		if (event.altKey) return 'subtract';
		if (event.shiftKey && !['marquee', 'ellipse_marquee'].includes(tool)) return 'add';
		return editor.selectionMode;
	}

	function documentPoint(
		event: Pick<PointerEvent, 'clientX' | 'clientY'>,
		outside: 'reject' | 'clamp' | 'allow' = 'reject'
	): SelectionPoint | null {
		const stage = stageElement;
		const document = editor.document;
		if (!stage || !document) return null;
		const bounds = stage.getBoundingClientRect();
		return imageEditorDocumentPoint(
			{ x: event.clientX, y: event.clientY },
			bounds,
			{ width: document.width_px, height: document.height_px },
			outside
		);
	}

	function pointerPressure(event: PointerEvent): number {
		if (event.pointerType === 'mouse') return 1;
		return event.pressure > 0 ? event.pressure : 0.5;
	}

	function rulerTicks(length: number): Array<{ value: number; major: boolean }> {
		const desiredDocumentStep = 12 / Math.max(editor.zoom, 0.05);
		const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
		const step = steps.find((candidate) => candidate >= desiredDocumentStep) ?? 1000;
		const majorEvery = step * 5;
		const ticks: Array<{ value: number; major: boolean }> = [];
		for (let value = 0; value <= length; value += step) {
			ticks.push({ value, major: value % majorEvery === 0 });
		}
		return ticks;
	}

	function guideValue(
		event: Pick<PointerEvent, 'clientX' | 'clientY' | 'ctrlKey' | 'metaKey'>,
		axis: 'horizontal' | 'vertical',
		index?: number
	): number | null {
		const point = documentPoint(event, 'allow');
		if (!point || !editor.document) return null;
		const limit = axis === 'horizontal' ? editor.document.height_px : editor.document.width_px;
		const previous =
			index === undefined
				? undefined
				: axis === 'horizontal'
					? editor.activePage?.guides?.horizontal[index]
					: editor.activePage?.guides?.vertical[index];
		const snapped = adapter?.snapDocumentPoint(point, {
			axes: axis === 'horizontal' ? 'y' : 'x',
			bypass: event.ctrlKey || event.metaKey,
			...(axis === 'horizontal' ? { excludeY: previous } : { excludeX: previous })
		});
		const value =
			axis === 'horizontal' ? (snapped?.point.y ?? point.y) : (snapped?.point.x ?? point.x);
		return Math.max(0, Math.min(limit, value));
	}

	function startGuide(event: PointerEvent, axis: 'horizontal' | 'vertical', index?: number): void {
		if (!editor.canEdit || event.button !== 0) return;
		const value = guideValue(event, axis, index);
		if (value === null) return;
		guideGesture = { pointerID: event.pointerId, axis, index, value };
		capturePointer(event.currentTarget, event.pointerId);
		event.preventDefault();
		event.stopPropagation();
	}

	function addCenteredGuideFromKeyboard(
		event: KeyboardEvent,
		axis: 'horizontal' | 'vertical'
	): void {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		const document = editor.document;
		if (!document) return;
		editor.addGuide(axis, (axis === 'horizontal' ? document.height_px : document.width_px) / 2);
	}

	function moveGuide(event: PointerEvent): void {
		if (!guideGesture || guideGesture.pointerID !== event.pointerId) return;
		const value = guideValue(event, guideGesture.axis, guideGesture.index);
		if (value !== null) guideGesture = { ...guideGesture, value };
		event.preventDefault();
		event.stopPropagation();
	}

	function finishGuide(event: PointerEvent): void {
		const gesture = guideGesture;
		if (!gesture || gesture.pointerID !== event.pointerId) return;
		if (gesture.index === undefined) editor.addGuide(gesture.axis, gesture.value);
		else editor.updateGuide(gesture.axis, gesture.index, gesture.value);
		guideGesture = null;
		adapter?.clearSnappingGuides();
		if (
			event.currentTarget instanceof Element &&
			event.currentTarget.hasPointerCapture(event.pointerId)
		) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		event.preventDefault();
		event.stopPropagation();
	}

	function cancelGuide(event: PointerEvent): void {
		if (!guideGesture || guideGesture.pointerID !== event.pointerId) return;
		guideGesture = null;
		adapter?.clearSnappingGuides();
		if (
			event.currentTarget instanceof Element &&
			event.currentTarget.hasPointerCapture(event.pointerId)
		) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
	}

	function guideKeydown(
		event: KeyboardEvent,
		axis: 'horizontal' | 'vertical',
		index: number,
		value: number
	): void {
		if (event.key === 'Delete' || event.key === 'Backspace') {
			event.preventDefault();
			editor.removeGuide(axis, index);
			return;
		}
		const relevant =
			axis === 'horizontal'
				? event.key === 'ArrowUp' || event.key === 'ArrowDown'
				: event.key === 'ArrowLeft' || event.key === 'ArrowRight';
		if (!relevant) return;
		event.preventDefault();
		const direction = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1;
		editor.updateGuide(axis, index, value + direction * (event.shiftKey ? 10 : 1));
	}

	function showMagicPulse(point: SelectionPoint): void {
		magicPulse = point;
		if (magicPulseTimer) clearTimeout(magicPulseTimer);
		magicPulseTimer = setTimeout(() => {
			magicPulse = null;
			magicPulseTimer = undefined;
		}, 420);
	}

	function selectionTargetIDs(point: SelectionPoint): string[] {
		const activeID = editor.selectedLayerIDs.at(-1);
		const active = editor.activePage?.layers.find((layer) => layer.id === activeID);
		if (activeID && active && !active.locked) return [activeID];
		const hitID = adapter?.topmostLayerIDAtPoint(point);
		if (!hitID) return [];
		editor.selectLayer(hitID);
		return [hitID];
	}

	function openLayerPicker(event: MouseEvent): void {
		if (editor.activeTool !== 'select' || !adapter) return;
		const point = documentPoint(event, 'reject');
		if (!point) return;
		const layerIDs = adapter.layerIDsAtPoint(point);
		if (layerIDs.length === 0) return;
		event.preventDefault();
		event.stopPropagation();
		layerPicker = { point, layerIDs };
		canvasAnnouncement = m.image_editor_select_layer_count({ count: layerIDs.length });
	}

	function layerPickerName(id: string): string {
		return editor.activePage?.layers.find((layer) => layer.id === id)?.name ?? id;
	}

	function chooseLayerFromPicker(id: string): void {
		editor.selectLayer(id);
		layerPicker = null;
		canvasAnnouncement = m.image_editor_layer_selected({ name: layerPickerName(id) });
	}

	function startLayerCycle(event: PointerEvent): void {
		if (!event.altKey || event.button !== 0 || editor.activeTool !== 'select' || !adapter) return;
		const point = documentPoint(event, 'reject');
		if (!point) return;
		const layerIDs = adapter.layerIDsAtPoint(point);
		if (layerIDs.length < 2) return;
		layerCycleGesture = {
			pointerID: event.pointerId,
			clientX: event.clientX,
			clientY: event.clientY,
			layerIDs
		};
	}

	function finishLayerCycle(event: PointerEvent): void {
		const gesture = layerCycleGesture;
		layerCycleGesture = null;
		if (
			!gesture ||
			gesture.pointerID !== event.pointerId ||
			Math.hypot(event.clientX - gesture.clientX, event.clientY - gesture.clientY) > 5
		)
			return;
		const current = gesture.layerIDs.findIndex((id) => editor.selectedLayerIDs.includes(id));
		const nextID = gesture.layerIDs[(current + 1) % gesture.layerIDs.length];
		editor.selectLayer(nextID);
		canvasAnnouncement = m.image_editor_layer_cycled({ name: layerPickerName(nextID) });
		event.preventDefault();
		event.stopPropagation();
	}

	function sampledPixels(point: SelectionPoint): {
		image: ImageData;
		targetLayerIDs: string[];
	} | null {
		const targetLayerIDs = editor.sampleAllLayers
			? (editor.activePage?.layers
					.filter((layer) => layer.visible && layer.type !== 'group')
					.map((layer) => layer.id) ?? [])
			: selectionTargetIDs(point);
		const image = adapter?.rasterizeLayerIDs(targetLayerIDs);
		return image ? { image, targetLayerIDs } : null;
	}

	function hasLockedMagicTarget(point: SelectionPoint): boolean {
		const activeID = editor.selectedLayerIDs.at(-1);
		const active = editor.activePage?.layers.find((layer) => layer.id === activeID);
		return Boolean(active?.locked || adapter?.lockedLayerIDAtPoint(point));
	}

	function magicNoTargetMessage(point: SelectionPoint, fallback: string): string {
		return hasLockedMagicTarget(point) ? m.image_editor_magic_target_locked() : fallback;
	}

	async function runMagicScan(
		image: ImageData,
		point: SelectionPoint,
		tolerance: number,
		contiguous: boolean,
		onComplete: (mask: Uint8Array) => void,
		preview = true
	): Promise<void> {
		magicScanAbort?.abort();
		const controller = new AbortController();
		magicScanAbort = controller;
		magicScanBusy = true;
		magicScanProgress = 0;
		magicScanError = '';
		try {
			const mask = await magicScan.scan(
				{
					width: image.width,
					height: image.height,
					data: image.data,
					point,
					tolerance,
					contiguous
				},
				{
					signal: controller.signal,
					onProgress: (fraction) => (magicScanProgress = fraction)
				}
			);
			if (controller.signal.aborted) return;
			if (
				preview &&
				editor.document &&
				image.width === editor.document.width_px &&
				image.height === editor.document.height_px
			) {
				magicPreviewMask = { width: image.width, height: image.height, data: mask };
				await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
			}
			onComplete(mask);
		} catch (cause) {
			if (cause instanceof DOMException && cause.name === 'AbortError') return;
			magicScanError =
				cause instanceof RangeError
					? m.image_editor_magic_scan_too_large({ limit: MAXIMUM_MAGIC_SCAN_PIXELS })
					: cause instanceof Error
						? cause.message
						: m.image_editor_magic_scan_failed();
			canvasAnnouncement = magicScanError;
		} finally {
			if (magicScanAbort === controller) magicScanAbort = null;
			magicScanBusy = false;
			magicScanProgress = 0;
			magicPreviewMask = null;
		}
	}

	function cancelMagicScan(): void {
		magicScanAbort?.abort();
		magicScan.cancel();
		magicScanBusy = false;
		magicPreviewMask = null;
		canvasAnnouncement = m.image_editor_magic_scan_cancelled();
	}

	function constrainMarqueePoint(
		start: SelectionPoint,
		point: SelectionPoint,
		event: PointerEvent
	): SelectionPoint {
		if (!event.shiftKey) return point;
		const size = Math.max(Math.abs(point.x - start.x), Math.abs(point.y - start.y));
		return {
			x: start.x + Math.sign(point.x - start.x || 1) * size,
			y: start.y + Math.sign(point.y - start.y || 1) * size
		};
	}

	function constrainGradientPoint(
		start: SelectionPoint,
		point: SelectionPoint,
		event: PointerEvent
	): SelectionPoint {
		let constrained = point;
		if (event.shiftKey) {
			const distance = Math.hypot(point.x - start.x, point.y - start.y);
			const angle = Math.atan2(point.y - start.y, point.x - start.x);
			const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
			constrained = {
				x: start.x + Math.cos(snapped) * distance,
				y: start.y + Math.sin(snapped) * distance
			};
		}
		return (
			adapter?.snapDocumentPoint(constrained, {
				bypass: event.ctrlKey || event.metaKey,
				excludeLayerIDs: editor.selectedLayerIDs
			}).point ?? constrained
		);
	}

	function targetsPasteboardChrome(target: EventTarget | null): boolean {
		return (
			target instanceof Element &&
			Boolean(
				target.closest(
					'[data-testid="image-editor-selection-options"], button, input, textarea, select, [role="slider"], [contenteditable="true"]'
				)
			)
		);
	}

	function startAreaSelection(event: PointerEvent): boolean {
		const tool = editor.activeTool;
		if (event.pointerType === 'touch' && stylusPointerID >= 0) {
			event.preventDefault();
			return true;
		}
		if (event.pointerType === 'pen' && (tool === 'pencil' || tool === 'eraser')) {
			if (
				selectionGesture &&
				(selectionGesture.tool === 'pencil' || selectionGesture.tool === 'eraser')
			) {
				selectionGesture = null;
			}
			touchPointers.clear();
			stylusPointerID = event.pointerId;
		}
		const startsOnStage = event.target instanceof Node && stageElement?.contains(event.target);
		const startsOnPasteboard =
			event.currentTarget === viewport && !targetsPasteboardChrome(event.target);
		if (!startsOnStage && !(startsOnPasteboard && isDragSelectionTool(tool))) return false;
		if (
			(!isAreaSelectionTool(tool) &&
				tool !== 'pencil' &&
				tool !== 'eraser' &&
				tool !== 'magic_eraser' &&
				tool !== 'bucket' &&
				tool !== 'gradient' &&
				tool !== 'eyedropper') ||
			!adapter ||
			event.button !== 0
		)
			return false;
		const point = documentPoint(event, startsOnStage ? 'reject' : 'allow');
		if (!point) return false;
		if (tool === 'pencil') point.pressure = pointerPressure(event);
		const mode = isAreaSelectionTool(tool)
			? selectionModeForEvent(event, tool)
			: editor.selectionMode;
		if (
			tool === 'eyedropper' ||
			(event.altKey && ['pencil', 'bucket', 'gradient'].includes(tool))
		) {
			sampleEyedropper(point, false);
			eyedropperPointerID = event.pointerId;
			capturePointer(event.currentTarget, event.pointerId);
			event.preventDefault();
			return true;
		}
		if (
			(tool === 'marquee' || tool === 'ellipse_marquee' || tool === 'lasso') &&
			mode === 'replace' &&
			editor.pixelSelection &&
			pixelMaskContainsPoint(
				editor.pixelSelection.data,
				editor.pixelSelection.width,
				editor.pixelSelection.height,
				point
			)
		) {
			selectionGesture = {
				tool,
				pointerID: event.pointerId,
				start: point,
				current: point,
				points: [point],
				mode,
				originalSelection: editor.pixelSelection.data.slice()
			};
			capturePointer(event.currentTarget, event.pointerId);
			event.preventDefault();
			return true;
		}
		if (tool === 'magic_eraser') {
			const targetLayerID = erasableTargetID(point);
			const sampled = targetLayerID ? adapter.rasterizeLayerAtPoint(targetLayerID, point) : null;
			if (targetLayerID && sampled) {
				void runMagicScan(
					sampled.image,
					sampled.point,
					editor.magicEraserTolerance,
					editor.magicEraserContiguous,
					(mask) =>
						editor.addMagicErase(targetLayerID, sampled.image.width, sampled.image.height, mask),
					false
				);
			} else {
				canvasAnnouncement = magicNoTargetMessage(
					point,
					m.image_editor_magic_erase_requires_target()
				);
			}
			showMagicPulse(point);
			event.preventDefault();
			return true;
		}
		if (tool === 'magic_wand') {
			const sampled = sampledPixels(point);
			if (sampled) {
				void runMagicScan(
					sampled.image,
					point,
					editor.magicSelectTolerance,
					editor.magicSelectContiguous,
					(mask) => editor.applyPixelSelection(mask, sampled.targetLayerIDs, mode)
				);
			} else {
				canvasAnnouncement = magicNoTargetMessage(point, m.image_editor_magic_select_no_target());
			}
			showMagicPulse(point);
			event.preventDefault();
			return true;
		}
		if (tool === 'bucket') {
			const sampled = sampledPixels(point);
			if (sampled) {
				void runMagicScan(
					sampled.image,
					point,
					editor.bucketTolerance,
					editor.bucketContiguous,
					(scannedMask) => {
						const mask = editor.pixelSelection
							? intersectPixelMasks(scannedMask, editor.pixelSelection.data)
							: scannedMask;
						editor.addPaintFill(mask);
					}
				);
			} else if (hasLockedMagicTarget(point)) {
				canvasAnnouncement = m.image_editor_magic_target_locked();
			} else if (editor.pixelSelection) {
				editor.addPaintFill(editor.pixelSelection.data);
			} else if (editor.document) {
				const mask = new Uint8Array(editor.document.width_px * editor.document.height_px);
				mask.fill(1);
				editor.addPaintFill(mask);
			}
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
			mode,
			targetLayerID: tool === 'eraser' ? (erasableTargetID(point) ?? undefined) : undefined
		};
		if (tool === 'eraser' && !selectionGesture.targetLayerID) {
			selectionGesture = null;
			return false;
		}
		capturePointer(event.currentTarget, event.pointerId);
		event.preventDefault();
		return true;
	}

	function startObjectSelection(event: PointerEvent): boolean {
		if (
			editor.activeTool !== 'select' ||
			spacePressed ||
			!adapter ||
			event.button !== 0 ||
			targetsPasteboardChrome(event.target)
		) {
			return false;
		}
		const point = documentPoint(event, 'allow');
		if (!point) return false;
		const mode = selectionModeForEvent(event, 'select');
		if (mode === 'replace') editor.applyLayerSelection([], 'replace');
		editor.clearPixelSelection();
		selectionGesture = {
			tool: 'select',
			pointerID: event.pointerId,
			start: point,
			current: point,
			points: [point],
			mode
		};
		capturePointer(event.currentTarget, event.pointerId);
		event.preventDefault();
		event.stopPropagation();
		return true;
	}

	function moveAreaSelection(event: PointerEvent): boolean {
		const gesture = selectionGesture;
		if (!gesture || gesture.pointerID !== event.pointerId) return false;
		let point = documentPoint(
			event,
			(gesture.tool === 'select' || isDragSelectionTool(gesture.tool)) && !gesture.originalSelection
				? 'allow'
				: 'clamp'
		);
		if (!point) return false;
		if (gesture.originalSelection) {
			point = constrainGradientPoint(gesture.start, point, event);
			if (editor.floatingPixelSelection) {
				editor.translateFloatingPixelSelection(
					point.x - gesture.current.x,
					point.y - gesture.current.y
				);
			} else {
				editor.movePixelSelection(
					gesture.originalSelection,
					point.x - gesture.start.x,
					point.y - gesture.start.y
				);
			}
		} else if (['marquee', 'ellipse_marquee'].includes(gesture.tool)) {
			point = constrainMarqueePoint(gesture.start, point, event);
		} else if (gesture.tool === 'gradient') {
			point = constrainGradientPoint(gesture.start, point, event);
		}
		let points = gesture.points;
		if (gesture.tool === 'pencil') {
			const samples = event.getCoalescedEvents?.().length ? event.getCoalescedEvents() : [event];
			for (const sample of samples) {
				const samplePoint = documentPoint(sample, 'clamp');
				if (!samplePoint) continue;
				samplePoint.pressure = pointerPressure(sample);
				const previous = points.at(-1) ?? samplePoint;
				if (
					Math.hypot(samplePoint.x - previous.x, samplePoint.y - previous.y) >=
					0.5 / Math.max(editor.zoom, 0.1)
				) {
					points = [...points, samplePoint];
				}
			}
			point.pressure = pointerPressure(event);
		} else if (
			(gesture.tool === 'lasso' || gesture.tool === 'eraser') &&
			Math.hypot(
				point.x - (gesture.points.at(-1)?.x ?? point.x),
				point.y - (gesture.points.at(-1)?.y ?? point.y)
			) >=
				3 / Math.max(editor.zoom, 0.1)
		) {
			points = [...gesture.points, point];
		}
		selectionGesture = { ...gesture, current: point, points };
		event.preventDefault();
		return true;
	}

	function finishAreaSelection(event: PointerEvent): boolean {
		const gesture = selectionGesture;
		if (!gesture || gesture.pointerID !== event.pointerId) return false;
		let point =
			documentPoint(
				event,
				(gesture.tool === 'select' || isDragSelectionTool(gesture.tool)) &&
					!gesture.originalSelection
					? 'allow'
					: 'clamp'
			) ?? gesture.current;
		if (gesture.originalSelection) {
			point = constrainGradientPoint(gesture.start, point, event);
			if (editor.floatingPixelSelection) {
				editor.translateFloatingPixelSelection(
					point.x - gesture.current.x,
					point.y - gesture.current.y
				);
				editor.finishFloatingPixelSelectionMove();
			} else {
				editor.movePixelSelection(
					gesture.originalSelection,
					point.x - gesture.start.x,
					point.y - gesture.start.y
				);
			}
			selectionGesture = null;
			if (
				event.currentTarget instanceof HTMLDivElement &&
				event.currentTarget.hasPointerCapture(event.pointerId)
			) {
				event.currentTarget.releasePointerCapture(event.pointerId);
			}
			event.preventDefault();
			return true;
		} else if (['marquee', 'ellipse_marquee'].includes(gesture.tool)) {
			point = constrainMarqueePoint(gesture.start, point, event);
		} else if (gesture.tool === 'gradient') {
			point = constrainGradientPoint(gesture.start, point, event);
		}
		const distance =
			gesture.tool === 'lasso'
				? Math.max(
						...gesture.points.map((sample) =>
							Math.hypot(sample.x - gesture.start.x, sample.y - gesture.start.y)
						),
						Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y)
					)
				: Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y);
		if (gesture.tool === 'select') {
			const candidates =
				distance < 5 / Math.max(editor.zoom, 0.1)
					? []
					: (adapter?.layerIDsInRectangle(normalizeSelectionBounds(gesture.start, point)) ?? []);
			editor.applyLayerSelection(candidates, gesture.mode);
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
		if (gesture.tool === 'pencil') {
			point.pressure = pointerPressure(event);
			editor.addPencilStroke([...gesture.points, point]);
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
		if (gesture.tool === 'eraser' && gesture.targetLayerID) {
			const stroke = adapter?.localEraseStroke(
				gesture.targetLayerID,
				[...gesture.points, point],
				editor.eraserSize
			);
			if (stroke) {
				editor.addEraseStroke(
					gesture.targetLayerID,
					stroke.sourceWidth,
					stroke.sourceHeight,
					stroke.points,
					stroke.size
				);
			}
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
		if (gesture.tool === 'gradient') {
			const document = editor.document;
			if (document) {
				const mask =
					editor.pixelSelection?.data ??
					rectanglePixelMask(document.width_px, document.height_px, {
						x: 0,
						y: 0,
						width: document.width_px,
						height: document.height_px
					});
				editor.addGradientFill(mask, gesture.start, point);
			}
			selectionGesture = null;
			adapter?.clearSnappingGuides();
			if (
				event.currentTarget instanceof HTMLDivElement &&
				event.currentTarget.hasPointerCapture(event.pointerId)
			) {
				event.currentTarget.releasePointerCapture(event.pointerId);
			}
			event.preventDefault();
			return true;
		}
		const targetLayerIDs = editor.selectedLayerIDs.slice(-1);
		let mask: Uint8Array | null = null;
		if (distance < 5 / Math.max(editor.zoom, 0.1)) {
			if (gesture.mode === 'replace') editor.clearPixelSelection();
		} else if (gesture.tool === 'marquee') {
			mask = rectanglePixelMask(
				editor.document?.width_px ?? 1,
				editor.document?.height_px ?? 1,
				normalizeSelectionBounds(gesture.start, point)
			);
		} else if (gesture.tool === 'ellipse_marquee') {
			mask = ellipsePixelMask(
				editor.document?.width_px ?? 1,
				editor.document?.height_px ?? 1,
				normalizeSelectionBounds(gesture.start, point)
			);
		} else {
			const points = [...gesture.points, point];
			if (points.length >= 3) {
				mask = polygonPixelMask(
					editor.document?.width_px ?? 1,
					editor.document?.height_px ?? 1,
					points
				);
			}
		}
		if (mask) editor.applyPixelSelection(mask, targetLayerIDs, gesture.mode);
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
		const cancelledTool = selectionGesture?.tool;
		if (selectionGesture?.pointerID === event.pointerId) {
			if (selectionGesture.originalSelection && editor.floatingPixelSelection) {
				editor.translateFloatingPixelSelection(
					selectionGesture.start.x - selectionGesture.current.x,
					selectionGesture.start.y - selectionGesture.current.y
				);
			}
			selectionGesture = null;
		}
		if (cancelledTool === 'gradient') adapter?.clearSnappingGuides();
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
			const currentZoom = editor.zoom;
			const boundedDelta = Math.max(-60, Math.min(60, event.deltaY));
			const nextZoom = Math.max(0.1, Math.min(4, currentZoom * Math.exp(-boundedDelta * 0.001)));
			const bounds = viewport?.getBoundingClientRect();
			if (bounds) {
				const anchorX = event.clientX - (bounds.left + bounds.width / 2);
				const anchorY = event.clientY - (bounds.top + bounds.height / 2);
				const nextPan = panForZoomAnchor({
					panX: editor.panX,
					panY: editor.panY,
					zoom: currentZoom,
					nextZoom,
					anchorX,
					anchorY
				});
				editor.panX = nextPan.panX;
				editor.panY = nextPan.panY;
			}
			editor.zoom = nextZoom;
			return;
		}
		event.preventDefault();
		const horizontalDelta = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
		editor.panX -= horizontalDelta;
		editor.panY -= event.shiftKey ? 0 : event.deltaY;
	}

	function handleMediaDragEnter(event: DragEvent): void {
		if (
			!containsImageEditorMediaDrag(event.dataTransfer) &&
			!containsExternalImageDrag(event.dataTransfer)
		)
			return;
		event.preventDefault();
		mediaDragDepth += 1;
		mediaDropActive = true;
	}

	function handleMediaDragOver(event: DragEvent): void {
		if (
			!containsImageEditorMediaDrag(event.dataTransfer) &&
			!containsExternalImageDrag(event.dataTransfer)
		)
			return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		mediaDropActive = true;
	}

	function handleMediaDragLeave(event: DragEvent): void {
		if (
			!containsImageEditorMediaDrag(event.dataTransfer) &&
			!containsExternalImageDrag(event.dataTransfer)
		)
			return;
		mediaDragDepth = Math.max(0, mediaDragDepth - 1);
		if (mediaDragDepth === 0) mediaDropActive = false;
	}

	function handleMediaDrop(event: DragEvent): void {
		const payload = readImageEditorMediaDrag(event.dataTransfer);
		const files = payload ? [] : externalFiles(event.dataTransfer);
		mediaDragDepth = 0;
		mediaDropActive = false;
		if (!payload && files.length === 0) return;
		event.preventDefault();
		if (!editor.canEdit) return;
		const point = documentPoint(event);
		if (!point) return;
		if (payload) editor.addImage(payload, point);
		else void onExternalFiles?.(files, point, editor.activePageID);
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
		if (spacePressed || editor.activeTool === 'hand' || event.button === 1) {
			panning = true;
			panStart = {
				x: event.clientX,
				y: event.clientY,
				panX: editor.panX,
				panY: editor.panY
			};
			capturePointer(event.currentTarget, event.pointerId);
			event.preventDefault();
			return;
		}
		if (startAreaSelection(event)) return;
	}

	function targetsToolSurface(event: PointerEvent): boolean {
		return (
			event.target instanceof Element &&
			Boolean(event.target.closest('[data-testid="image-editor-selection-surface"]'))
		);
	}

	function startPasteboardPointer(event: PointerEvent): void {
		if (targetsToolSurface(event)) return;
		// A touch that lands on pasteboard chrome still belongs to viewport navigation.
		// Route it before object hit-testing so the second contact can always start a pinch.
		if (event.pointerType === 'touch') {
			startPan(event);
			return;
		}
		if (
			event.button === 0 &&
			editor.activeTool === 'select' &&
			!spacePressed &&
			!adapter?.hasInteractiveTarget(event)
		) {
			if (startObjectSelection(event)) return;
		}
		startPan(event);
	}

	function movePasteboardPointer(event: PointerEvent): void {
		if (!targetsToolSurface(event)) movePan(event);
	}

	function stopPasteboardPointer(event: PointerEvent): void {
		if (!targetsToolSurface(event)) stopPan(event);
	}

	function cancelPasteboardPointer(event: PointerEvent): void {
		if (!targetsToolSurface(event)) cancelPointer(event);
	}

	function movePan(event: PointerEvent): void {
		cursorPoint = documentPoint(event);
		if (editor.activeTool === 'pencil' || editor.activeTool === 'eraser') {
			brushPreview = documentPoint(event);
		}
		if (
			(editor.activeTool === 'eyedropper' || eyedropperPointerID === event.pointerId) &&
			!panning
		) {
			const point = documentPoint(event);
			if (point) queueEyedropperSample(point);
		}
		if (event.pointerType === 'touch' && touchPointers.has(event.pointerId)) {
			touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
			if (touchPointers.size >= 2) {
				const [first, second] = [...touchPointers.values()];
				const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
				const centerX = (first.x + second.x) / 2;
				const centerY = (first.y + second.y) / 2;
				const nextZoom = Math.max(
					0.1,
					Math.min(4, pinchStart.zoom * (distance / Math.max(1, pinchStart.distance)))
				);
				const bounds = viewport?.getBoundingClientRect();
				if (bounds) {
					const viewportCenterX = bounds.left + bounds.width / 2;
					const viewportCenterY = bounds.top + bounds.height / 2;
					const nextPan = panForZoomAnchor({
						panX: pinchStart.panX,
						panY: pinchStart.panY,
						zoom: pinchStart.zoom,
						nextZoom,
						anchorX: pinchStart.centerX - viewportCenterX,
						anchorY: pinchStart.centerY - viewportCenterY,
						nextAnchorX: centerX - viewportCenterX,
						nextAnchorY: centerY - viewportCenterY
					});
					editor.panX = nextPan.panX;
					editor.panY = nextPan.panY;
				}
				editor.zoom = nextZoom;
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
		if (eyedropperPointerID === event.pointerId) {
			const point = documentPoint(event, 'clamp');
			if (point) sampleEyedropper(point, true);
			eyedropperPointerID = -1;
			if (
				event.currentTarget instanceof Element &&
				event.currentTarget.hasPointerCapture(event.pointerId)
			) {
				event.currentTarget.releasePointerCapture(event.pointerId);
			}
			return;
		}
		if (finishAreaSelection(event)) {
			if (stylusPointerID === event.pointerId) stylusPointerID = -1;
			return;
		}
		if (stylusPointerID === event.pointerId) stylusPointerID = -1;
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
		if (eyedropperPointerID === event.pointerId) eyedropperPointerID = -1;
		if (stylusPointerID === event.pointerId) stylusPointerID = -1;
		cancelAreaSelection(event);
		panning = false;
	}

	function editableTarget(target: EventTarget | null): boolean {
		return (
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement ||
			(target instanceof HTMLElement && target.isContentEditable)
		);
	}

	function handleCanvasKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape' && layerPicker) {
			layerPicker = null;
			event.preventDefault();
			return;
		}
		const insideEyedropperOptions =
			event.target instanceof Element &&
			Boolean(event.target.closest('[data-testid="image-editor-eyedropper-options"]'));
		if (
			editor.activeTool === 'eyedropper' &&
			!editableTarget(event.target) &&
			!insideEyedropperOptions
		) {
			if (moveEyedropperCursor(event)) {
				event.preventDefault();
				event.stopImmediatePropagation();
				return;
			}
			if (event.key === 'Enter') {
				const point =
					eyedropperKeyboardCursor ??
					eyedropperPreview?.point ??
					(editor.document
						? {
								x: Math.floor(editor.document.width_px / 2),
								y: Math.floor(editor.document.height_px / 2)
							}
						: null);
				if (point) {
					eyedropperKeyboardCursor = point;
					sampleEyedropper(point, true);
				}
				event.preventDefault();
				event.stopImmediatePropagation();
				return;
			}
			if (event.key === 'Escape') {
				eyedropperKeyboardCursor = null;
				eyedropperPreview = null;
				editor.activeTool = 'select';
				canvasAnnouncement = m.image_editor_eyedropper_cancelled();
				event.preventDefault();
				event.stopImmediatePropagation();
				return;
			}
		}
		if (editor.floatingPixelSelection && !editableTarget(event.target)) {
			if (event.key === 'Enter') {
				event.preventDefault();
				event.stopImmediatePropagation();
				commitFloatingPixels();
				return;
			}
			if (event.key === 'Escape') {
				event.preventDefault();
				event.stopImmediatePropagation();
				cancelFloatingPixels();
				return;
			}
			if (event.key === 'Delete' || event.key === 'Backspace') {
				event.preventDefault();
				event.stopImmediatePropagation();
				deleteFloatingPixels();
				return;
			}
		}
		if (
			editor.pixelSelection &&
			!editableTarget(event.target) &&
			(event.key === 'Delete' || event.key === 'Backspace')
		) {
			event.preventDefault();
			event.stopImmediatePropagation();
			commitPixelContent('delete');
			return;
		}
		if (editor.activeTool === 'crop' && !editableTarget(event.target)) {
			if (event.key === 'Escape') {
				event.preventDefault();
				cancelCrop();
				return;
			}
			if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
				event.preventDefault();
				applyCrop();
				return;
			}
		}
		if (event.code !== 'Space' || editableTarget(event.target)) return;
		event.preventDefault();
		spacePressed = true;
	}

	function handleCanvasKeyup(event: KeyboardEvent): void {
		if (event.code === 'Space') spacePressed = false;
	}

	function marqueeBounds(gesture: SelectionGesture): SelectionBounds {
		return normalizeSelectionBounds(gesture.start, gesture.current);
	}

	function lassoPoints(gesture: SelectionGesture): string {
		return gesture.points.map((point) => `${point.x},${point.y}`).join(' ');
	}
</script>

<svelte:window
	onkeydown={handleCanvasKeydown}
	onkeyup={handleCanvasKeyup}
	onblur={() => (spacePressed = false)}
/>

<div
	{@attach attachViewport}
	class="image-editor-pasteboard relative size-full min-h-0 touch-none overflow-hidden bg-neutral-800 dark:bg-neutral-950"
	class:cursor-grab={(editor.activeTool === 'hand' || spacePressed) && !panning}
	class:cursor-grabbing={panning}
	class:cursor-move={Boolean(editor.floatingPixelSelection) && !panning}
	class:cursor-crosshair={(usesCanvasSurface() || selectionGesture?.tool === 'select') &&
		!editor.floatingPixelSelection &&
		!panning}
	onwheel={handleWheel}
	onpointerdowncapture={startPasteboardPointer}
	onpointermovecapture={movePasteboardPointer}
	onpointerupcapture={stopPasteboardPointer}
	onpointercancelcapture={cancelPasteboardPointer}
	ondragenter={handleMediaDragEnter}
	ondragover={handleMediaDragOver}
	ondragleave={handleMediaDragLeave}
	ondrop={handleMediaDrop}
	role="application"
	aria-label={m.image_editor_design_canvas()}
>
	<div class="sr-only" aria-live="polite">{canvasAnnouncement}</div>
	{#if mediaDropActive}
		<div
			class="pointer-events-none absolute inset-0 z-40 grid place-items-center bg-primary/12 ring-4 ring-primary ring-inset"
			data-testid="image-editor-media-drop-target"
		>
			<span
				class="max-w-[calc(100%-2rem)] rounded-full border border-white/15 bg-neutral-950/90 px-4 py-2 text-center text-sm font-semibold text-white shadow-xl backdrop-blur"
			>
				{m.image_editor_drop_to_place()}
			</span>
		</div>
	{/if}
	{#if editor.document}
		{#if editor.activeTool === 'eyedropper'}
			<div
				class="pointer-events-none absolute top-3 left-1/2 z-30 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-lg border border-white/10 bg-neutral-950/88 p-1.5 text-neutral-100 shadow-lg backdrop-blur [&>*]:pointer-events-auto"
				data-testid="image-editor-eyedropper-options"
			>
				<span class="hidden px-1 text-xs font-medium sm:inline">{m.image_editor_eyedropper()}</span>
				<AppSelect
					value={editor.eyedropperTarget}
					ariaLabel={m.image_editor_eyedropper_target()}
					onValueChange={(value) => (editor.eyedropperTarget = value as ImageEditorColorTarget)}
					options={[
						{ value: 'foreground', label: m.image_editor_eyedropper_foreground() },
						{ value: 'selected_fill', label: m.image_editor_eyedropper_selected_fill() },
						{ value: 'selected_stroke', label: m.image_editor_eyedropper_selected_stroke() },
						{ value: 'page_background', label: m.image_editor_eyedropper_page_background() }
					]}
					class="h-8 w-40 border-white/15 bg-neutral-900 text-neutral-100"
				/>
				<Button
					variant={editor.sampleAllLayers ? 'secondary' : 'ghost'}
					size="sm"
					class="h-8 px-2 text-xs text-neutral-100 hover:text-foreground"
					aria-pressed={editor.sampleAllLayers}
					onclick={() => (editor.sampleAllLayers = !editor.sampleAllLayers)}
				>
					{editor.sampleAllLayers
						? m.image_editor_sample_composite()
						: m.image_editor_sample_active_layer()}
				</Button>
				<span class="hidden px-1 text-xs text-neutral-300 xl:inline">
					{m.image_editor_eyedropper_keyboard_help()}
				</span>
				{#if eyedropperPreview}
					<span
						class="size-6 rounded border border-white/30"
						style:background-color={`${eyedropperPreview.color}${eyedropperPreview.alpha.toString(16).padStart(2, '0')}`}
						aria-hidden="true"
					></span>
					<span class="font-mono text-xs">
						{eyedropperPreview.color.toUpperCase()} · {Math.round(
							(eyedropperPreview.alpha / 255) * 100
						)}%
					</span>
				{/if}
			</div>
		{/if}
		{#if magicScanBusy || magicScanError}
			<div
				class="absolute top-3 left-1/2 z-50 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-lg border bg-background/95 px-3 py-2 text-xs shadow-lg"
				role="status"
			>
				<span>
					{magicScanError ||
						m.image_editor_magic_scanning({ value: Math.round(magicScanProgress * 100) })}
				</span>
				{#if magicScanBusy}
					<Button variant="ghost" size="xs" onclick={cancelMagicScan}>{m.common_cancel()}</Button>
				{/if}
			</div>
		{/if}
		{#if editor.activeTool === 'crop' && cropLayer}
			<div
				class="pointer-events-none absolute top-3 left-1/2 z-30 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-lg border border-white/10 bg-neutral-950/88 p-1.5 text-neutral-100 shadow-lg backdrop-blur [&>*]:pointer-events-auto"
				data-testid="image-editor-crop-options"
			>
				<span class="hidden px-1 text-xs font-medium sm:inline">{m.image_editor_crop()}</span>
				<AppSelect
					value={cropAspect}
					ariaLabel={m.image_editor_crop_aspect()}
					onValueChange={setCropAspect}
					options={[
						{ value: 'free', label: m.image_editor_crop_free() },
						{ value: 'original', label: m.image_editor_crop_original() },
						{ value: '1', label: m.image_editor_crop_square() },
						{ value: '0.8', label: m.image_editor_crop_portrait() },
						{ value: String(1.91), label: m.image_editor_crop_landscape() },
						{ value: String(9 / 16), label: m.image_editor_crop_story() },
						{ value: String(16 / 9), label: m.image_editor_crop_thumbnail() }
					]}
					class="h-8 w-36 border-white/15 bg-neutral-900 text-neutral-100"
				/>
				<div
					class="flex items-center gap-1"
					role="group"
					aria-label={m.image_editor_crop_interaction_mode()}
				>
					<Button
						variant={cropMode === 'frame' ? 'secondary' : 'ghost'}
						size="sm"
						class="h-8 px-2 text-xs text-neutral-100 hover:text-foreground [@media(pointer:coarse)]:h-11"
						aria-pressed={cropMode === 'frame'}
						onclick={() => setCropMode('frame')}
					>
						{m.image_editor_crop_frame_mode()}
					</Button>
					<Button
						variant={cropMode === 'content' ? 'secondary' : 'ghost'}
						size="sm"
						class="h-8 px-2 text-xs text-neutral-100 hover:text-foreground [@media(pointer:coarse)]:h-11"
						aria-pressed={cropMode === 'content'}
						onclick={() => setCropMode('content')}
					>
						{m.image_editor_crop_content_mode()}
					</Button>
				</div>
				<div
					class="flex items-center gap-0.5"
					role="group"
					aria-label={m.image_editor_crop_orientation()}
				>
					{#each [{ label: m.image_editor_crop_rotate_left(), action: () => rotateCrop(-90), icon: RotateCcwIcon }, { label: m.image_editor_crop_rotate_right(), action: () => rotateCrop(90), icon: RotateCwIcon }, { label: m.image_editor_crop_flip_horizontal(), action: () => flipCrop('x'), icon: FlipHorizontalIcon }, { label: m.image_editor_crop_flip_vertical(), action: () => flipCrop('y'), icon: FlipVerticalIcon }] as control (control.label)}
						{@const ControlIcon = control.icon}
						<Button
							variant="ghost"
							size="icon"
							class="size-8 text-neutral-100 hover:text-foreground [@media(pointer:coarse)]:size-11"
							aria-label={control.label}
							title={control.label}
							onclick={control.action}
						>
							<ControlIcon />
						</Button>
					{/each}
				</div>
				<Button
					variant="ghost"
					size="sm"
					class="h-8 px-2 text-xs text-neutral-100 hover:text-foreground [@media(pointer:coarse)]:h-11"
					onclick={resetCrop}
				>
					{m.image_editor_reset()}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					class="h-8 px-2 text-xs text-neutral-100 hover:text-foreground [@media(pointer:coarse)]:h-11"
					onclick={cancelCrop}
				>
					{m.common_cancel()}
				</Button>
				<Button
					size="sm"
					class="h-8 px-2 text-xs [@media(pointer:coarse)]:h-11"
					onclick={applyCrop}
				>
					{m.image_editor_apply_crop()}
				</Button>
			</div>
		{/if}
		{#if isAreaSelectionTool() || editor.activeTool === 'pencil' || editor.activeTool === 'eraser' || editor.activeTool === 'magic_eraser' || editor.activeTool === 'bucket' || editor.activeTool === 'gradient'}
			<div
				class="pointer-events-none absolute top-3 left-1/2 z-30 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-lg border border-white/10 bg-neutral-950/88 p-1.5 text-neutral-100 shadow-lg backdrop-blur [&>*]:pointer-events-auto"
				data-testid="image-editor-selection-options"
			>
				<span class="hidden px-1 text-xs font-medium sm:inline">
					{editor.activeTool === 'marquee'
						? m.image_editor_rectangle_select()
						: editor.activeTool === 'ellipse_marquee'
							? m.image_editor_ellipse_select()
							: editor.activeTool === 'lasso'
								? m.image_editor_lasso_select()
								: editor.activeTool === 'magic_wand'
									? m.image_editor_magic_select()
									: editor.activeTool === 'pencil'
										? m.image_editor_pencil()
										: editor.activeTool === 'eraser'
											? m.image_editor_erase()
											: editor.activeTool === 'magic_eraser'
												? m.image_editor_magic_erase()
												: editor.activeTool === 'gradient'
													? m.image_editor_gradient()
													: m.image_editor_paint_bucket()}
				</span>
				{#if isAreaSelectionTool()}
					<div
						class="flex items-center gap-0.5"
						role="group"
						aria-label={m.image_editor_selection_mode()}
					>
						{#each [{ value: 'replace', label: m.image_editor_selection_replace() }, { value: 'add', label: m.image_editor_selection_add() }, { value: 'subtract', label: m.image_editor_selection_subtract() }, { value: 'intersect', label: m.image_editor_selection_intersect() }] as mode (mode.value)}
							<Button
								variant={editor.selectionMode === mode.value ? 'secondary' : 'ghost'}
								size="sm"
								class="h-8 px-2 text-xs text-neutral-100 hover:text-foreground [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-11"
								aria-pressed={editor.selectionMode === mode.value}
								onclick={() => (editor.selectionMode = mode.value as ImageEditorSelectionMode)}
							>
								{mode.label}
							</Button>
						{/each}
					</div>
				{/if}
				{#if editor.activeTool === 'magic_wand' || editor.activeTool === 'magic_eraser' || editor.activeTool === 'bucket'}
					<label class="flex min-w-40 items-center gap-2 px-1 text-xs">
						<span class="whitespace-nowrap">
							{m.image_editor_magic_tolerance({
								value:
									editor.activeTool === 'bucket'
										? editor.bucketTolerance
										: editor.activeTool === 'magic_eraser'
											? editor.magicEraserTolerance
											: editor.magicSelectTolerance
							})}
						</span>
						<Slider
							value={editor.activeTool === 'bucket'
								? editor.bucketTolerance
								: editor.activeTool === 'magic_eraser'
									? editor.magicEraserTolerance
									: editor.magicSelectTolerance}
							min={0}
							max={255}
							step={1}
							class="w-24"
							ariaLabel={m.image_editor_magic_tolerance({
								value:
									editor.activeTool === 'bucket'
										? editor.bucketTolerance
										: editor.activeTool === 'magic_eraser'
											? editor.magicEraserTolerance
											: editor.magicSelectTolerance
							})}
							onValueChange={(value) => {
								if (editor.activeTool === 'bucket') editor.bucketTolerance = value;
								else if (editor.activeTool === 'magic_eraser') editor.magicEraserTolerance = value;
								else editor.magicSelectTolerance = value;
							}}
						/>
					</label>
					<Button
						variant={(
							editor.activeTool === 'bucket'
								? editor.bucketContiguous
								: editor.activeTool === 'magic_eraser'
									? editor.magicEraserContiguous
									: editor.magicSelectContiguous
						)
							? 'secondary'
							: 'ghost'}
						size="sm"
						class="h-8 px-2 text-xs text-neutral-100 hover:text-foreground"
						aria-pressed={editor.activeTool === 'bucket'
							? editor.bucketContiguous
							: editor.activeTool === 'magic_eraser'
								? editor.magicEraserContiguous
								: editor.magicSelectContiguous}
						onclick={() => {
							if (editor.activeTool === 'bucket') {
								editor.bucketContiguous = !editor.bucketContiguous;
							} else if (editor.activeTool === 'magic_eraser') {
								editor.magicEraserContiguous = !editor.magicEraserContiguous;
							} else {
								editor.magicSelectContiguous = !editor.magicSelectContiguous;
							}
						}}
					>
						{m.image_editor_contiguous()}
					</Button>
					{#if editor.activeTool !== 'magic_eraser'}
						<Button
							variant={editor.sampleAllLayers ? 'secondary' : 'ghost'}
							size="sm"
							class="h-8 px-2 text-xs text-neutral-100 hover:text-foreground"
							aria-pressed={editor.sampleAllLayers}
							onclick={() => (editor.sampleAllLayers = !editor.sampleAllLayers)}
						>
							{m.image_editor_sample_all_layers()}
						</Button>
					{/if}
				{/if}
				{#if ['pencil', 'bucket', 'gradient'].includes(editor.activeTool)}
					<PaintColorControls
						primary={editor.paintColor}
						secondary={editor.gradientEndColor}
						gradient={editor.activeTool === 'gradient'}
						brandColors={editor.brandKit?.colors ?? []}
						recentColors={editor.recentColors}
						onPrimaryChange={(value) => (editor.paintColor = value)}
						onSecondaryChange={(value) => (editor.gradientEndColor = value)}
						onCommit={(value) => editor.rememberColor(value)}
					/>
				{/if}
				{#if editor.activeTool === 'gradient'}
					<label class="grid gap-0.5 text-xs">
						<span class="sr-only">{m.image_editor_gradient_style()}</span>
						<AppSelect
							value={editor.gradientType}
							ariaLabel={m.image_editor_gradient_style()}
							onValueChange={(value) => (editor.gradientType = value as ImageEditorGradientType)}
							options={[
								{ value: 'linear', label: m.image_editor_gradient_linear() },
								{ value: 'radial', label: m.image_editor_gradient_radial() },
								{ value: 'angle', label: m.image_editor_gradient_angle() },
								{ value: 'reflected', label: m.image_editor_gradient_reflected() },
								{ value: 'diamond', label: m.image_editor_gradient_diamond() }
							]}
							class="h-8 w-36 border-white/15 bg-neutral-900 text-neutral-100"
						/>
					</label>
					<Button
						variant={editor.gradientReverse ? 'secondary' : 'ghost'}
						size="sm"
						class="h-8 px-2 text-xs text-neutral-100 hover:text-foreground"
						aria-pressed={editor.gradientReverse}
						onclick={() => (editor.gradientReverse = !editor.gradientReverse)}
					>
						{m.image_editor_gradient_reverse()}
					</Button>
				{/if}
				{#if editor.activeTool === 'pencil' || editor.activeTool === 'eraser'}
					<label class="flex min-w-36 items-center gap-2 px-1 text-xs">
						<span class="whitespace-nowrap"
							>{m.image_editor_brush_size({
								value: editor.activeTool === 'eraser' ? editor.eraserSize : editor.pencilSize
							})}</span
						>
						<Slider
							value={editor.activeTool === 'eraser' ? editor.eraserSize : editor.pencilSize}
							min={1}
							max={256}
							step={1}
							class="w-20"
							ariaLabel={m.image_editor_brush_size({
								value: editor.activeTool === 'eraser' ? editor.eraserSize : editor.pencilSize
							})}
							onValueChange={(value) => {
								if (editor.activeTool === 'eraser') editor.eraserSize = value;
								else editor.pencilSize = value;
							}}
						/>
					</label>
				{/if}
				{#if editor.activeTool === 'pencil'}
					<label class="flex min-w-40 items-center gap-2 px-1 text-xs">
						<span class="whitespace-nowrap">
							{m.image_editor_pencil_roughness({
								value: Math.round(editor.pencilRoughness * 100)
							})}
						</span>
						<Slider
							value={Math.round(editor.pencilRoughness * 100)}
							min={0}
							max={100}
							step={1}
							class="w-20"
							ariaLabel={m.image_editor_pencil_roughness({
								value: Math.round(editor.pencilRoughness * 100)
							})}
							onValueChange={(value) => (editor.pencilRoughness = value / 100)}
						/>
					</label>
					<label class="flex min-w-40 items-center gap-2 px-1 text-xs">
						<span class="whitespace-nowrap">
							{m.image_editor_smoothing({ value: Math.round(editor.pencilSmoothing * 100) })}
						</span>
						<Slider
							value={Math.round(editor.pencilSmoothing * 100)}
							min={0}
							max={95}
							step={1}
							class="w-20"
							ariaLabel={m.image_editor_smoothing({
								value: Math.round(editor.pencilSmoothing * 100)
							})}
							onValueChange={(value) => (editor.pencilSmoothing = value / 100)}
						/>
					</label>
					<Button
						variant={editor.pencilPressure ? 'secondary' : 'ghost'}
						size="sm"
						class="h-8 px-2 text-xs text-neutral-100 hover:text-foreground"
						aria-pressed={editor.pencilPressure}
						onclick={() => (editor.pencilPressure = !editor.pencilPressure)}
					>
						{m.image_editor_pen_pressure()}
					</Button>
				{/if}
				{#if ['pencil', 'bucket', 'gradient'].includes(editor.activeTool)}
					<label class="flex min-w-34 items-center gap-2 px-1 text-xs">
						<span class="whitespace-nowrap">
							{m.image_editor_opacity({ value: Math.round(editor.paintOpacity * 100) })}
						</span>
						<Slider
							value={Math.round(editor.paintOpacity * 100)}
							min={1}
							max={100}
							step={1}
							class="w-18"
							ariaLabel={m.image_editor_opacity({
								value: Math.round(editor.paintOpacity * 100)
							})}
							onValueChange={(value) => (editor.paintOpacity = value / 100)}
						/>
					</label>
				{/if}
				{#if editor.pixelSelection}
					{#if editor.floatingPixelSelection}
						<span class="hidden px-1 text-xs text-neutral-300 xl:inline">
							{m.image_editor_floating_pixels_help()}
						</span>
						<Button size="sm" class="h-8 px-2 text-xs" onclick={commitFloatingPixels}>
							{m.common_done()}
						</Button>
						<Button
							variant="outline"
							size="sm"
							class="h-8 px-2 text-xs"
							onclick={() => editor.duplicateFloatingPixelSelection()}
						>
							{m.image_editor_duplicate()}
						</Button>
						<Button
							variant="ghost"
							size="sm"
							class="h-8 px-2 text-xs text-neutral-100 hover:text-foreground"
							onclick={cancelFloatingPixels}
						>
							{m.common_cancel()}
						</Button>
					{:else}
						<Button
							variant="ghost"
							size="sm"
							class="h-8 px-2 text-xs text-neutral-100 hover:text-foreground"
							onclick={() => commitPixelContent('promote')}
						>
							{m.image_editor_promote_pixels()}
						</Button>
						<Button
							variant="outline"
							size="sm"
							class="h-8 px-2 text-xs"
							onclick={() => commitPixelContent('cut')}
						>
							{m.image_editor_cut_pixels()}
						</Button>
						<Button
							variant="ghost"
							size="sm"
							class="h-8 px-2 text-xs text-red-200 hover:text-destructive"
							onclick={() => commitPixelContent('delete')}
						>
							{m.image_editor_delete_pixels()}
						</Button>
						<Button
							variant="ghost"
							size="sm"
							class="h-8 px-2 text-xs text-neutral-100 hover:text-foreground"
							onclick={() => editor.clearPixelSelection()}
						>
							{m.image_editor_deselect_pixels()}
						</Button>
					{/if}
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
				role="region"
				aria-label={m.image_editor_design_canvas()}
				data-testid="image-editor-stage"
				style:width={`${editor.document.width_px * editor.zoom}px`}
				style:height={`${editor.document.height_px * editor.zoom}px`}
				style:--image-editor-zoom={editor.zoom}
				style:--image-editor-pencil-color={editor.paintColor}
				onpointerdown={startLayerCycle}
				onpointerup={finishLayerCycle}
				onpointercancel={() => (layerCycleGesture = null)}
				oncontextmenu={openLayerPicker}
			>
				{#if editor.showRulers}
					<div
						class="absolute -top-6 left-0 z-40 h-6 w-full cursor-s-resize overflow-hidden border-b border-neutral-600 bg-neutral-800 text-neutral-300 shadow-sm"
						role="button"
						tabindex="0"
						aria-label={m.image_editor_add_vertical_guide()}
						onpointerdown={(event) => startGuide(event, 'vertical')}
						onpointermove={moveGuide}
						onpointerup={finishGuide}
						onpointercancel={cancelGuide}
						onkeydown={(event) => addCenteredGuideFromKeyboard(event, 'vertical')}
					>
						{#each rulerTicks(editor.document.width_px) as tick (tick.value)}
							<span
								class="absolute bottom-0 border-l border-neutral-400/70"
								class:h-3={tick.major}
								class:h-1.5={!tick.major}
								style:left={`${tick.value * editor.zoom}px`}
							>
								{#if tick.major}
									<span class="absolute bottom-2 left-0.5 text-[8px] leading-none"
										>{tick.value}</span
									>
								{/if}
							</span>
						{/each}
					</div>
					<div
						class="absolute top-0 -left-6 z-40 h-full w-6 cursor-e-resize overflow-hidden border-r border-neutral-600 bg-neutral-800 text-neutral-300 shadow-sm"
						role="button"
						tabindex="0"
						aria-label={m.image_editor_add_horizontal_guide()}
						onpointerdown={(event) => startGuide(event, 'horizontal')}
						onpointermove={moveGuide}
						onpointerup={finishGuide}
						onpointercancel={cancelGuide}
						onkeydown={(event) => addCenteredGuideFromKeyboard(event, 'horizontal')}
					>
						{#each rulerTicks(editor.document.height_px) as tick (tick.value)}
							<span
								class="absolute right-0 border-t border-neutral-400/70"
								class:w-3={tick.major}
								class:w-1.5={!tick.major}
								style:top={`${tick.value * editor.zoom}px`}
							></span>
						{/each}
					</div>
				{/if}
				{#key canvasAttempt}
					<canvas {@attach attachCanvas} aria-hidden="true"></canvas>
				{/key}
				{#if editor.showGrid}
					<div
						class="pointer-events-none absolute inset-0 z-9"
						style:background-image={GRID_BACKGROUND_IMAGE}
						style:background-size={`${editor.gridSize * editor.zoom}px ${editor.gridSize * editor.zoom}px`}
						aria-hidden="true"
					></div>
				{/if}
				{#if editor.showGuides}
					{#each editor.activePage?.guides?.vertical ?? [] as value, index (`vertical-${index}`)}
						<button
							type="button"
							class="group absolute top-0 z-35 h-full w-3 -translate-x-1/2 cursor-ew-resize touch-none border-0 bg-transparent p-0"
							style:left={`${value * editor.zoom}px`}
							aria-label={m.image_editor_vertical_guide_at({ value: Math.round(value) })}
							onpointerdown={(event) => startGuide(event, 'vertical', index)}
							onpointermove={moveGuide}
							onpointerup={finishGuide}
							onpointercancel={cancelGuide}
							onkeydown={(event) => guideKeydown(event, 'vertical', index, value)}
						>
							<span
								class="mx-auto block h-full w-px bg-cyan-400 shadow-[0_0_0_1px_rgb(0_0_0/0.45)] group-focus-visible:w-0.5"
							></span>
						</button>
					{/each}
					{#each editor.activePage?.guides?.horizontal ?? [] as value, index (`horizontal-${index}`)}
						<button
							type="button"
							class="group absolute left-0 z-35 h-3 w-full -translate-y-1/2 cursor-ns-resize touch-none border-0 bg-transparent p-0"
							style:top={`${value * editor.zoom}px`}
							aria-label={m.image_editor_horizontal_guide_at({ value: Math.round(value) })}
							onpointerdown={(event) => startGuide(event, 'horizontal', index)}
							onpointermove={moveGuide}
							onpointerup={finishGuide}
							onpointercancel={cancelGuide}
							onkeydown={(event) => guideKeydown(event, 'horizontal', index, value)}
						>
							<span
								class="my-auto block h-px w-full bg-cyan-400 shadow-[0_0_0_1px_rgb(0_0_0/0.45)] group-focus-visible:h-0.5"
							></span>
						</button>
					{/each}
					{#if guideGesture}
						<div
							class={guideGesture.axis === 'vertical'
								? 'pointer-events-none absolute top-0 z-35 h-full w-px bg-cyan-200'
								: 'pointer-events-none absolute left-0 z-35 h-px w-full bg-cyan-200'}
							style:left={guideGesture.axis === 'vertical'
								? `${guideGesture.value * editor.zoom}px`
								: undefined}
							style:top={guideGesture.axis === 'horizontal'
								? `${guideGesture.value * editor.zoom}px`
								: undefined}
							aria-hidden="true"
						></div>
					{/if}
				{/if}
				{#if usesCanvasSurface()}
					<div
						class="absolute inset-0 z-10 touch-none"
						class:cursor-move={Boolean(editor.floatingPixelSelection)}
						class:cursor-crosshair={!editor.floatingPixelSelection}
						data-testid="image-editor-selection-surface"
						aria-hidden="true"
						onpointerdown={startPan}
						onpointermove={movePan}
						onpointerup={stopPan}
						onpointercancel={cancelPointer}
						onpointerleave={() => {
							if (editor.activeTool === 'eyedropper' && !eyedropperKeyboardCursor) {
								eyedropperPreview = null;
							}
							if (editor.activeTool === 'pencil' || editor.activeTool === 'eraser') {
								brushPreview = null;
							}
						}}
					></div>
				{/if}
				<canvas
					{@attach attachSelectionOverlay}
					width={editor.document.width_px}
					height={editor.document.height_px}
					class="pointer-events-none absolute inset-0 z-15 size-full"
					data-testid="image-editor-pixel-selection"
					data-active={editor.pixelSelection ? 'true' : 'false'}
					aria-hidden="true"
				></canvas>
				{#if editor.floatingPixelSelection && editor.floatingPixelSelectionBounds}
					{@const floatingBounds = editor.floatingPixelSelectionBounds}
					<div
						class="pointer-events-none absolute z-20 border border-dashed border-orange-400 shadow-[0_0_0_1px_rgb(0_0_0/0.55)]"
						style:left={`${floatingBounds.x * editor.zoom}px`}
						style:top={`${floatingBounds.y * editor.zoom}px`}
						style:width={`${floatingBounds.width * editor.zoom}px`}
						style:height={`${floatingBounds.height * editor.zoom}px`}
						role="group"
						aria-label={m.image_editor_floating_transform()}
						data-testid="image-editor-floating-transform"
					>
						<button
							type="button"
							class="pointer-events-auto absolute -top-14 left-1/2 size-11 -translate-x-1/2 touch-none rounded-full border border-neutral-950 bg-white shadow after:absolute after:top-10 after:left-1/2 after:h-4 after:border-l after:border-orange-400"
							aria-label={m.image_editor_rotate_floating_pixels()}
							onpointerdown={(event) => startFloatingTransform(event, 'rotate')}
							onpointermove={moveFloatingTransform}
							onpointerup={finishFloatingTransform}
							onpointercancel={finishFloatingTransform}
							onkeydown={(event) => nudgeFloatingTransform(event, 'rotate')}
						></button>
						{#each [{ handle: 'nw', class: '-top-[22px] -left-[22px] cursor-nwse-resize' }, { handle: 'n', class: '-top-[22px] left-1/2 -translate-x-1/2 cursor-ns-resize' }, { handle: 'ne', class: '-top-[22px] -right-[22px] cursor-nesw-resize' }, { handle: 'e', class: 'top-1/2 -right-[22px] -translate-y-1/2 cursor-ew-resize' }, { handle: 'se', class: '-right-[22px] -bottom-[22px] cursor-nwse-resize' }, { handle: 's', class: '-bottom-[22px] left-1/2 -translate-x-1/2 cursor-ns-resize' }, { handle: 'sw', class: '-bottom-[22px] -left-[22px] cursor-nesw-resize' }, { handle: 'w', class: 'top-1/2 -left-[22px] -translate-y-1/2 cursor-ew-resize' }] as item (item.handle)}
							<button
								type="button"
								class={`pointer-events-auto absolute size-11 touch-none border-0 bg-transparent ${item.class}`}
								aria-label={m.image_editor_resize_floating_pixels({ handle: item.handle })}
								onpointerdown={(event) =>
									startFloatingTransform(event, item.handle as FloatingTransformHandle)}
								onpointermove={moveFloatingTransform}
								onpointerup={finishFloatingTransform}
								onpointercancel={finishFloatingTransform}
								onkeydown={(event) =>
									nudgeFloatingTransform(event, item.handle as FloatingTransformHandle)}
							>
								<span
									class="pointer-events-none absolute top-1/2 left-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-neutral-950 bg-white shadow"
								></span>
							</button>
						{/each}
					</div>
				{/if}
				{#if layerPicker}
					<div
						class="absolute z-50 max-w-64 min-w-44 rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl"
						style:left={`${Math.min(editor.document.width_px - 180 / editor.zoom, layerPicker.point.x) * editor.zoom}px`}
						style:top={`${Math.min(editor.document.height_px - 48 / editor.zoom, layerPicker.point.y) * editor.zoom}px`}
						role="menu"
						aria-label={m.image_editor_select_layer()}
						data-testid="image-editor-layer-picker"
					>
						<p class="px-2 py-1 text-xs font-medium text-muted-foreground">
							{m.image_editor_select_layer()}
						</p>
						{#each layerPicker.layerIDs as id (id)}
							<button
								type="button"
								class="flex min-h-10 w-full items-center rounded-md px-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
								role="menuitem"
								onclick={() => chooseLayerFromPicker(id)}
							>
								<span class="min-w-0 flex-1 truncate">{layerPickerName(id)}</span>
							</button>
						{/each}
					</div>
				{/if}
				{#if editor.activeTool === 'crop' && cropPreviewLayer}
					<div class="pointer-events-none absolute inset-0 z-25 overflow-hidden">
						<div
							class="image-editor-crop-frame pointer-events-auto absolute touch-none border-2 border-white shadow-[0_0_0_9999px_rgb(0_0_0/0.58)]"
							class:cursor-move={cropMode === 'frame'}
							class:cursor-grabbing={cropMode === 'content'}
							role="group"
							aria-label={m.image_editor_crop_frame()}
							data-mode={cropMode}
							style:left={`${cropPreviewLayer.transform.x * editor.zoom}px`}
							style:top={`${cropPreviewLayer.transform.y * editor.zoom}px`}
							style:width={`${cropPreviewLayer.transform.width * editor.zoom}px`}
							style:height={`${cropPreviewLayer.transform.height * editor.zoom}px`}
							style:transform={`rotate(${cropPreviewLayer.transform.rotation}deg)`}
							style:transform-origin="top left"
							onpointerdown={(event) => {
								if (event.target instanceof Element && event.target.closest('[data-crop-handle]')) {
									return;
								}
								startCrop(event, cropMode === 'content' ? 'content' : 'move');
							}}
							onpointermove={moveCrop}
							onpointerup={stopCrop}
							onpointercancel={stopCrop}
						>
							<span class="pointer-events-none absolute inset-x-0 top-1/3 border-t border-white/55"
							></span>
							<span class="pointer-events-none absolute inset-x-0 top-2/3 border-t border-white/55"
							></span>
							<span class="pointer-events-none absolute inset-y-0 left-1/3 border-l border-white/55"
							></span>
							<span class="pointer-events-none absolute inset-y-0 left-2/3 border-l border-white/55"
							></span>
							<button
								type="button"
								class="absolute inset-6 border-0 bg-transparent"
								class:cursor-move={cropMode === 'frame'}
								class:cursor-grabbing={cropMode === 'content'}
								aria-label={cropMode === 'content'
									? m.image_editor_crop_move_image()
									: m.image_editor_crop_move()}
								onpointerdown={(event) =>
									startCrop(event, cropMode === 'content' ? 'content' : 'move')}
								onkeydown={(event) => nudgeCrop(event, cropMode === 'content' ? 'content' : 'move')}
							></button>
							{#if cropMode === 'frame'}
								{#each [{ handle: 'nw', label: m.image_editor_crop_handle_nw(), class: '-top-[22px] -left-[22px] cursor-nwse-resize' }, { handle: 'n', label: m.image_editor_crop_handle_n(), class: '-top-[22px] left-1/2 -translate-x-1/2 cursor-ns-resize' }, { handle: 'ne', label: m.image_editor_crop_handle_ne(), class: '-top-[22px] -right-[22px] cursor-nesw-resize' }, { handle: 'e', label: m.image_editor_crop_handle_e(), class: 'top-1/2 -right-[22px] -translate-y-1/2 cursor-ew-resize' }, { handle: 'se', label: m.image_editor_crop_handle_se(), class: '-right-[22px] -bottom-[22px] cursor-nwse-resize' }, { handle: 's', label: m.image_editor_crop_handle_s(), class: '-bottom-[22px] left-1/2 -translate-x-1/2 cursor-ns-resize' }, { handle: 'sw', label: m.image_editor_crop_handle_sw(), class: '-bottom-[22px] -left-[22px] cursor-nesw-resize' }, { handle: 'w', label: m.image_editor_crop_handle_w(), class: 'top-1/2 -left-[22px] -translate-y-1/2 cursor-ew-resize' }] as handle (handle.handle)}
									<button
										type="button"
										class={`image-editor-crop-handle absolute z-10 size-11 border-0 bg-transparent ${handle.class}`}
										data-crop-handle={handle.handle}
										aria-label={handle.label}
										onpointerdown={(event) => startCrop(event, handle.handle as CropHandle)}
										onkeydown={(event) => nudgeCrop(event, handle.handle as CropHandle)}
									>
										<span
											class="pointer-events-none absolute top-1/2 left-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-neutral-950 bg-white shadow"
										></span>
									</button>
								{/each}
							{/if}
						</div>
					</div>
				{/if}
				{#if editor.activeTool === 'eyedropper' && eyedropperPreview}
					{@const magnifierOffset = eyedropperMagnifierOffset(eyedropperPreview.point)}
					<div
						class="pointer-events-none absolute z-30 grid place-items-center gap-1 rounded-lg border-2 border-white bg-neutral-950 p-1.5 text-[9px] font-semibold text-white shadow-xl"
						style:left={`${eyedropperPreview.point.x * editor.zoom + magnifierOffset.x}px`}
						style:top={`${eyedropperPreview.point.y * editor.zoom + magnifierOffset.y}px`}
						data-testid="image-editor-eyedropper-magnifier"
						aria-hidden="true"
					>
						<div
							class="eyedropper-grid grid overflow-hidden rounded-sm border border-white/40"
							style:grid-template-columns={`repeat(${eyedropperPreview.grid.width}, 0.375rem)`}
						>
							{#each Array.from( { length: eyedropperPreview.grid.width * eyedropperPreview.grid.height } ) as _, index (index)}
								<span
									class="size-1.5"
									class:ring-2={index ===
										Math.floor(eyedropperPreview.grid.width / 2) * eyedropperPreview.grid.width +
											Math.floor(eyedropperPreview.grid.width / 2)}
									class:ring-white={index ===
										Math.floor(eyedropperPreview.grid.width / 2) * eyedropperPreview.grid.width +
											Math.floor(eyedropperPreview.grid.width / 2)}
									class:ring-inset={index ===
										Math.floor(eyedropperPreview.grid.width / 2) * eyedropperPreview.grid.width +
											Math.floor(eyedropperPreview.grid.width / 2)}
									style:background-color={eyedropperPixelColor(eyedropperPreview.grid, index)}
								></span>
							{/each}
						</div>
						<span>{eyedropperPreview.color.toUpperCase()}</span>
					</div>
				{/if}
				{#if (editor.activeTool === 'pencil' || editor.activeTool === 'eraser') && brushPreview}
					<div
						class="pointer-events-none absolute z-30 rounded-full border border-white shadow-[0_0_0_1px_rgb(0_0_0/0.8)]"
						style:left={`${(brushPreview.x - (editor.activeTool === 'eraser' ? editor.eraserSize : editor.pencilSize) / 2) * editor.zoom}px`}
						style:top={`${(brushPreview.y - (editor.activeTool === 'eraser' ? editor.eraserSize : editor.pencilSize) / 2) * editor.zoom}px`}
						style:width={`${(editor.activeTool === 'eraser' ? editor.eraserSize : editor.pencilSize) * editor.zoom}px`}
						style:height={`${(editor.activeTool === 'eraser' ? editor.eraserSize : editor.pencilSize) * editor.zoom}px`}
						aria-hidden="true"
					></div>
				{/if}
				{#if selectionGesture && !selectionGesture.originalSelection}
					<svg
						class="pointer-events-none absolute inset-0 z-20 size-full overflow-visible"
						viewBox={`0 0 ${editor.document.width_px} ${editor.document.height_px}`}
						aria-hidden="true"
					>
						{#if selectionGesture.tool === 'select' || selectionGesture.tool === 'marquee'}
							{@const bounds = marqueeBounds(selectionGesture)}
							<rect
								class="image-editor-selection-outline"
								data-testid={selectionGesture.tool === 'select'
									? 'image-editor-object-selection-outline'
									: undefined}
								x={bounds.x}
								y={bounds.y}
								width={bounds.width}
								height={bounds.height}
							/>
						{:else if selectionGesture.tool === 'ellipse_marquee'}
							{@const bounds = marqueeBounds(selectionGesture)}
							<ellipse
								class="image-editor-selection-outline"
								cx={bounds.x + bounds.width / 2}
								cy={bounds.y + bounds.height / 2}
								rx={bounds.width / 2}
								ry={bounds.height / 2}
							/>
						{:else if selectionGesture.tool === 'pencil' || selectionGesture.tool === 'eraser'}
							<polyline
								class={selectionGesture.tool === 'eraser'
									? 'image-editor-eraser-preview'
									: 'image-editor-pencil-preview'}
								points={lassoPoints(selectionGesture)}
								stroke-width={selectionGesture.tool === 'eraser'
									? editor.eraserSize
									: editor.pencilSize}
							/>
						{:else if selectionGesture.tool === 'gradient'}
							<line
								class="image-editor-gradient-preview"
								x1={selectionGesture.start.x}
								y1={selectionGesture.start.y}
								x2={selectionGesture.current.x}
								y2={selectionGesture.current.y}
							/>
							<circle
								class="image-editor-gradient-preview-point"
								cx={selectionGesture.start.x}
								cy={selectionGesture.start.y}
								r={5 / Math.max(editor.zoom, 0.1)}
							/>
							<circle
								class="image-editor-gradient-preview-point"
								cx={selectionGesture.current.x}
								cy={selectionGesture.current.y}
								r={5 / Math.max(editor.zoom, 0.1)}
							/>
						{:else}
							<polygon
								class="image-editor-selection-outline"
								points={lassoPoints(selectionGesture)}
							/>
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
							class="image-editor-magic-pulse"
							cx={magicPulse.x}
							cy={magicPulse.y}
							r={18 / Math.max(editor.zoom, 0.1)}
						/>
					</svg>
				{/if}
			</div>
		</div>
		{#if cursorPoint}
			<div
				class="pointer-events-none absolute right-3 bottom-3 hidden rounded bg-neutral-950/80 px-2 py-1 font-mono text-[10px] text-neutral-200 lg:block"
			>
				{Math.round(cursorPoint.x)}, {Math.round(cursorPoint.y)} px
			</div>
		{/if}
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
			{m.image_editor_preparing_canvas()}
		</div>
	{/if}
</div>

<style>
	.fabric-stage {
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

	.fabric-stage :global(.canvas-container) {
		transform: scale(var(--image-editor-zoom));
		transform-origin: top left;
	}

	.eyedropper-grid {
		background-color: #fff;
		background-image: conic-gradient(#d4d4d8 25%, #fff 0 50%, #d4d4d8 0 75%, #fff 0);
		background-size: 0.75rem 0.75rem;
	}

	.image-editor-selection-outline {
		fill: rgb(249 115 22 / 0.12);
		stroke: #fb923c;
		stroke-width: calc(1.5 / var(--image-editor-zoom));
		stroke-dasharray: calc(7 / var(--image-editor-zoom)) calc(5 / var(--image-editor-zoom));
		vector-effect: non-scaling-stroke;
		animation: image-editor-selection-march 0.65s linear infinite;
	}

	.image-editor-magic-pulse {
		fill: rgb(249 115 22 / 0.14);
		stroke: #fb923c;
		stroke-width: 2;
		vector-effect: non-scaling-stroke;
		animation: image-editor-magic-pulse 0.42s ease-out forwards;
	}

	.image-editor-gradient-preview {
		stroke: #fff;
		stroke-width: calc(2 / var(--image-editor-zoom));
		vector-effect: non-scaling-stroke;
		filter: drop-shadow(0 0 1px #000);
	}

	.image-editor-gradient-preview-point {
		fill: #f97316;
		stroke: #fff;
		stroke-width: calc(1.5 / var(--image-editor-zoom));
		vector-effect: non-scaling-stroke;
	}

	/* Adjacent 44px crop targets overlap on small images. Diamond hit regions keep the
	   targets large while ensuring each visible handle's center belongs to that handle. */
	.image-editor-crop-handle {
		clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
	}

	.image-editor-pencil-preview {
		fill: none;
		stroke: var(--image-editor-pencil-color, #f97316);
		stroke-linecap: round;
		stroke-linejoin: round;
		opacity: 0.86;
	}

	.image-editor-eraser-preview {
		fill: none;
		stroke: rgb(255 255 255 / 0.72);
		stroke-linecap: round;
		stroke-linejoin: round;
		filter: drop-shadow(0 0 1px rgb(0 0 0 / 0.9));
	}

	@keyframes image-editor-selection-march {
		to {
			stroke-dashoffset: -12;
		}
	}

	@keyframes image-editor-magic-pulse {
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
		.image-editor-selection-outline,
		.image-editor-magic-pulse {
			animation: none;
		}
	}
</style>
