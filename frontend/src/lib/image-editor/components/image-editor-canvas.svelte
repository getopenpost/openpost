<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { Button } from '$lib/components/ui/button';
	import { Slider } from '$lib/components/ui/slider';
	import AppSelect from '$lib/components/app-select.svelte';
	import { OpenPostFabricAdapter } from '../fabric-adapter';
	import { useImageEditor } from '../editor.svelte';
	import PaintColorControls from './paint-color-controls.svelte';
	import { m } from '$lib/paraglide/messages';
	import { startImageEditorMetric } from '../telemetry';
	import {
		ellipsePixelMask,
		intersectPixelMasks,
		magicPixelMask,
		normalizeSelectionBounds,
		pixelMaskContainsPoint,
		polygonPixelMask,
		rectanglePixelMask,
		type SelectionBounds,
		type SelectionPoint
	} from '../selection';
	import type {
		ImageEditorGradientType,
		ImageEditorSelectionMode,
		ImageEditorSelectionTool
	} from '../types';
	import {
		containsImageEditorMediaDrag,
		readImageEditorMediaDrag,
		IMAGE_EDITOR_MEDIA_DRAG_TYPE
	} from '../media-drag';
	import { panForZoomAnchor } from '../viewport';

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
	let selectionOverlay = $state<HTMLCanvasElement>();
	let magicPulseTimer: ReturnType<typeof setTimeout> | undefined;
	let mediaDropActive = $state(false);
	let mediaDragDepth = 0;
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
					if (textEditing) return;
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
		const selection = editor.pixelSelection;
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
			editor.activeTool === 'gradient'
		);
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
		const x = ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * document.width_px;
		const y = ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * document.height_px;
		if (
			outside === 'reject' &&
			(x < 0 || y < 0 || x > document.width_px || y > document.height_px)
		) {
			return null;
		}
		if (outside === 'allow') return { x, y };
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

	function selectionTargetIDs(point: SelectionPoint): string[] {
		const activeID = editor.selectedLayerIDs.at(-1);
		if (activeID) return [activeID];
		const hitID = adapter?.topmostLayerIDAtPoint(point);
		if (!hitID) return [];
		editor.selectLayer(hitID);
		return [hitID];
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
		if (!event.shiftKey) return point;
		const distance = Math.hypot(point.x - start.x, point.y - start.y);
		const angle = Math.atan2(point.y - start.y, point.x - start.x);
		const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
		return {
			x: start.x + Math.cos(snapped) * distance,
			y: start.y + Math.sin(snapped) * distance
		};
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
				tool !== 'gradient') ||
			!adapter ||
			event.button !== 0
		)
			return false;
		const point = documentPoint(event, startsOnStage ? 'reject' : 'allow');
		if (!point) return false;
		const mode = isAreaSelectionTool(tool)
			? selectionModeForEvent(event, tool)
			: editor.selectionMode;
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
			if (event.currentTarget instanceof HTMLDivElement) {
				event.currentTarget.setPointerCapture(event.pointerId);
			}
			event.preventDefault();
			return true;
		}
		if (tool === 'magic_eraser') {
			const targetLayerID = erasableTargetID(point);
			const sampled = targetLayerID ? adapter.rasterizeLayerAtPoint(targetLayerID, point) : null;
			if (targetLayerID && sampled) {
				editor.addMagicErase(
					targetLayerID,
					sampled.image.width,
					sampled.image.height,
					magicPixelMask(
						sampled.image,
						sampled.point,
						editor.magicEraserTolerance,
						editor.magicEraserContiguous
					)
				);
			}
			showMagicPulse(point);
			event.preventDefault();
			return true;
		}
		if (tool === 'magic_wand') {
			const sampled = sampledPixels(point);
			if (sampled) {
				editor.applyPixelSelection(
					magicPixelMask(
						sampled.image,
						point,
						editor.magicSelectTolerance,
						editor.magicSelectContiguous
					),
					sampled.targetLayerIDs,
					mode
				);
			}
			showMagicPulse(point);
			event.preventDefault();
			return true;
		}
		if (tool === 'bucket') {
			const sampled = sampledPixels(point);
			if (sampled) {
				let mask = magicPixelMask(
					sampled.image,
					point,
					editor.bucketTolerance,
					editor.bucketContiguous
				);
				if (editor.pixelSelection) {
					mask = intersectPixelMasks(mask, editor.pixelSelection.data);
				}
				editor.addPaintFill(mask);
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
		if (event.currentTarget instanceof HTMLDivElement) {
			event.currentTarget.setPointerCapture(event.pointerId);
		}
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
		if (event.currentTarget instanceof HTMLDivElement) {
			event.currentTarget.setPointerCapture(event.pointerId);
		}
		event.preventDefault();
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
			editor.movePixelSelection(
				gesture.originalSelection,
				point.x - gesture.start.x,
				point.y - gesture.start.y
			);
		} else if (['marquee', 'ellipse_marquee'].includes(gesture.tool)) {
			point = constrainMarqueePoint(gesture.start, point, event);
		} else if (gesture.tool === 'gradient') {
			point = constrainGradientPoint(gesture.start, point, event);
		}
		const points =
			(gesture.tool === 'lasso' || gesture.tool === 'pencil' || gesture.tool === 'eraser') &&
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
			editor.movePixelSelection(
				gesture.originalSelection,
				point.x - gesture.start.x,
				point.y - gesture.start.y
			);
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
			const currentZoom = editor.zoom;
			const nextZoom = Math.max(0.1, Math.min(4, currentZoom * (event.deltaY > 0 ? 0.9 : 1.1)));
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
		if (editor.activeTool === 'hand' || event.shiftKey) {
			event.preventDefault();
			editor.panX -= event.deltaX || event.deltaY;
			editor.panY -= event.deltaY;
		}
	}

	function handleMediaDragEnter(event: DragEvent): void {
		if (!containsImageEditorMediaDrag(event.dataTransfer)) return;
		event.preventDefault();
		mediaDragDepth += 1;
		mediaDropActive = true;
	}

	function handleMediaDragOver(event: DragEvent): void {
		if (!containsImageEditorMediaDrag(event.dataTransfer)) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		mediaDropActive = true;
	}

	function handleMediaDragLeave(event: DragEvent): void {
		if (!containsImageEditorMediaDrag(event.dataTransfer)) return;
		mediaDragDepth = Math.max(0, mediaDragDepth - 1);
		if (mediaDragDepth === 0) mediaDropActive = false;
	}

	function handleMediaDrop(event: DragEvent): void {
		const payload = readImageEditorMediaDrag(event.dataTransfer);
		mediaDragDepth = 0;
		mediaDropActive = false;
		if (!payload || !editor.canEdit) return;
		event.preventDefault();
		const point = documentPoint(event);
		if (point) editor.addImage(payload, point);
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
			if (event.currentTarget instanceof HTMLDivElement) {
				event.currentTarget.setPointerCapture(event.pointerId);
			}
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
		const outsideStage = !(event.target instanceof Node) || !stageElement?.contains(event.target);
		if (outsideStage && event.button === 0 && editor.activeTool === 'select' && !spacePressed) {
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

	function editableTarget(target: EventTarget | null): boolean {
		return (
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement ||
			(target instanceof HTMLElement && target.isContentEditable)
		);
	}

	function handleCanvasKeydown(event: KeyboardEvent): void {
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
	class:cursor-crosshair={(usesCanvasSurface() || selectionGesture?.tool === 'select') && !panning}
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
	{#if editor.document}
		{#if isAreaSelectionTool() || editor.activeTool === 'pencil' || editor.activeTool === 'eraser' || editor.activeTool === 'magic_eraser' || editor.activeTool === 'bucket' || editor.activeTool === 'gradient'}
			<div
				class="absolute top-3 left-1/2 z-30 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-lg border border-white/10 bg-neutral-950/88 p-1.5 text-neutral-100 shadow-lg backdrop-blur"
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
					<Button
						variant="ghost"
						size="sm"
						class="h-8 px-2 text-xs text-neutral-100 hover:text-foreground"
						onclick={() => editor.clearPixelSelection()}
					>
						{m.image_editor_deselect_pixels()}
					</Button>
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
				data-testid="image-editor-stage"
				style:width={`${editor.document.width_px * editor.zoom}px`}
				style:height={`${editor.document.height_px * editor.zoom}px`}
				style:--image-editor-zoom={editor.zoom}
				style:--image-editor-pencil-color={editor.paintColor}
			>
				{#key canvasAttempt}
					<canvas {@attach attachCanvas} aria-hidden="true"></canvas>
				{/key}
				{#if usesCanvasSurface()}
					<div
						class="absolute inset-0 z-10 cursor-crosshair touch-none"
						data-testid="image-editor-selection-surface"
						aria-hidden="true"
						onpointerdown={startPan}
						onpointermove={movePan}
						onpointerup={stopPan}
						onpointercancel={cancelPointer}
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
				{#if mediaDropActive}
					<div
						class="pointer-events-none absolute inset-0 z-30 grid place-items-center rounded-sm bg-primary/12 ring-4 ring-primary ring-inset"
						data-testid="image-editor-media-drop-target"
					>
						<span
							class="rounded-full border border-white/15 bg-neutral-950/90 px-4 py-2 text-sm font-semibold text-white shadow-xl backdrop-blur"
						>
							{m.image_editor_drop_to_place()}
						</span>
					</div>
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
