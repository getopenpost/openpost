<!-- Direct crop, anchor, text, and motion-path editing over the preview. -->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import type {
		CropSettings,
		ItemTransform,
		SpatialBezierTangents,
		TimelineItem,
		TimelineItemCornerPin
	} from '$lib/video-editor/project/types';
	import { loadedTextFontFamily } from '$lib/video-editor/typography/text-style';
	import {
		buildMotionPathPoints,
		calculateAnchorDrag,
		calculateCropFromDrag,
		calculateTransformResize,
		calculateTransformRotation,
		CROP_EDGE_PROPERTY,
		type CanvasAnimatedValues,
		MIN_TRANSFORM_SIZE,
		positionKeyframeFrames,
		resolveCrop,
		type CropEdge,
		type MotionPathPoint,
		type Point,
		transformHandleCursor,
		transformHandlePoint,
		type TransformHandle
	} from '$lib/video-editor/preview/on-canvas-tools';
	import { withSpatialTangent } from '$lib/video-editor/timeline/vector-keyframes';
	import {
		applyCanvasMoveSnapping,
		applyCanvasResizeSnapping,
		computeCanvasItemBounds,
		type CanvasSnapLabel,
		type CanvasSnapLine,
		type SnapTransform
	} from '$lib/video-editor/preview/canvas-snapping';
	import type { AnimatedItemMotionContext } from '$lib/video-editor/timeline/animated-properties';
	import PathEditorOverlay from './path-editor-overlay.svelte';
	import CornerPinOverlay from './corner-pin-overlay.svelte';

	type CanvasTool = 'transform' | 'crop' | 'anchor' | 'text' | 'motion' | 'path' | 'corner-pin';
	type TransformOperation = 'move' | 'resize' | 'rotate';
	const TRANSFORM_HANDLES: TransformHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

	let {
		item,
		motionSourceItem = item,
		motionContext,
		canvasWidth,
		canvasHeight,
		currentFrame,
		isPlaying = false,
		snapItems = [],
		snappingEnabled = true,
		ontransformdraft,
		oncropdraft,
		ontextdraft,
		oncornerpindraft,
		ontextediting,
		oncommitvalues,
		oncommitposition,
		oncreatespatial,
		oncommitspatial,
		oncommittext,
		oncommitcornerpin,
		onseek,
		onedit
	}: {
		item: TimelineItem;
		motionSourceItem?: TimelineItem;
		motionContext?: AnimatedItemMotionContext;
		canvasWidth: number;
		canvasHeight: number;
		currentFrame: number;
		isPlaying?: boolean;
		snapItems?: TimelineItem[];
		snappingEnabled?: boolean;
		ontransformdraft: (transform: ItemTransform | null) => void;
		oncropdraft: (crop: CropSettings | null) => void;
		ontextdraft: (text: string | null) => void;
		oncornerpindraft: (pin: TimelineItemCornerPin | null) => void;
		ontextediting: (editing: boolean) => void;
		oncommitvalues: (frame: number, values: CanvasAnimatedValues) => boolean;
		oncommitposition: (frame: number, x: number, y: number) => boolean;
		oncreatespatial: (frame: number) => boolean;
		oncommitspatial: (frame: number, spatial: SpatialBezierTangents) => boolean;
		oncommittext: (text: string) => void;
		oncommitcornerpin: (pin: TimelineItemCornerPin) => void;
		onseek: (frame: number) => void;
		onedit: () => void;
	} = $props();

	let root = $state<HTMLDivElement | null>(null);
	let textEditor = $state<HTMLDivElement | null>(null);
	let activeTool = $state<CanvasTool>('transform');
	let draftTransform = $state<ItemTransform | null>(null);
	let draftCrop = $state<CropSettings | null>(null);
	let draftText = $state<string | null>(null);
	let motionDraft = $state<{ frame: number; x: number; y: number } | null>(null);
	let spatialDraft = $state<{ frame: number; spatial: SpatialBezierTangents } | null>(null);
	let snapLines = $state<CanvasSnapLine[]>([]);
	let activeMotionFrame = $state<number | null>(null);
	let textSession = $state(false);
	let screenScale = $state(1);
	let cancellingText = false;
	let previousItemId = '';
	let cancelActiveGesture: (() => void) | null = null;

	const transform = $derived(draftTransform ?? item.transform ?? {});
	const width = $derived(Math.max(MIN_TRANSFORM_SIZE, transform.width ?? canvasWidth));
	const height = $derived(Math.max(MIN_TRANSFORM_SIZE, transform.height ?? canvasHeight));
	const anchorX = $derived(transform.anchorX ?? width / 2);
	const anchorY = $derived(transform.anchorY ?? height / 2);
	const rotation = $derived(transform.rotation ?? 0);
	const canCrop = $derived(['video', 'image', 'lottie'].includes(item.type));
	const canEditText = $derived(item.type === 'text');
	const canEditPath = $derived(item.type === 'shape' && item.shapeType === 'path');
	const canCornerPin = $derived(
		['video', 'image', 'text', 'shape', 'subtitle', 'composition'].includes(item.type)
	);
	const hasMotion = $derived(positionKeyframeFrames(motionSourceItem).length > 0);
	const motionPoints = $derived(
		buildMotionPathPoints({
			item: motionSourceItem,
			canvasWidth,
			canvasHeight,
			preview: motionDraft ?? undefined,
			spatialPreview: spatialDraft ?? undefined,
			motionContext
		})
	);
	const activeMotionPoint = $derived(
		motionPoints.find(
			(point) => point.isKeyframe && point.frame === (activeMotionFrame ?? currentFrame)
		)
	);
	const currentTransform = $derived.by(() => {
		const point = motionPoints.find((candidate) => candidate.frame === motionDraft?.frame);
		return (
			point ?? {
				x: canvasWidth / 2 + (transform.x ?? 0),
				y: canvasHeight / 2 + (transform.y ?? 0)
			}
		);
	});
	const boxStyle = $derived(
		[
			`left:${50 + ((transform.x ?? 0) / canvasWidth) * 100}%`,
			`top:${50 + ((transform.y ?? 0) / canvasHeight) * 100}%`,
			`width:${(width / canvasWidth) * 100}%`,
			`height:${(height / canvasHeight) * 100}%`,
			`transform:translate(${(-anchorX / width) * 100}%,${(-anchorY / height) * 100}%) rotate(${rotation}deg)`
		].join(';')
	);
	const otherItemBounds = $derived(
		snapItems
			.filter((candidate) => candidate.id !== item.id && candidate.transform)
			.map((candidate) =>
				computeCanvasItemBounds(
					snapTransform(candidate.transform ?? {}),
					canvasWidth,
					canvasHeight,
					shapeStrokeExpansion(candidate)
				)
			)
	);

	$effect(() => {
		if (item.id === previousItemId) return;
		previousItemId = item.id;
		cancelDrafts();
		activeTool = canEditPath ? 'path' : 'transform';
	});

	$effect(() => {
		if (activeTool === 'crop' && !canCrop) activeTool = 'transform';
		if (activeTool === 'text' && !canEditText) activeTool = 'transform';
		if (activeTool === 'motion' && !hasMotion) activeTool = 'transform';
		if (activeTool === 'path' && !canEditPath) activeTool = 'transform';
		if (activeTool === 'corner-pin' && !canCornerPin) activeTool = 'transform';
	});

	$effect(() => {
		if (activeTool !== 'text' || !canEditText) return;
		startTextSession();
	});

	$effect(() => {
		if (!isPlaying) return;
		motionDraft = null;
		spatialDraft = null;
		if (activeTool === 'motion') activeTool = 'transform';
		if (activeTool === 'path') activeTool = 'transform';
	});

	$effect(() => {
		const node = root;
		if (!node) return;
		const update = () => {
			const rect = node.getBoundingClientRect();
			screenScale = Math.max(
				0.0001,
				Math.min(rect.width / canvasWidth, rect.height / canvasHeight)
			);
		};
		const observer = new ResizeObserver(update);
		observer.observe(node);
		update();
		return () => observer.disconnect();
	});

	onDestroy(() => cancelActiveGesture?.());

	function canvasPoint(event: PointerEvent): Point {
		const rect = root?.getBoundingClientRect();
		if (!rect || rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
		return {
			x: ((event.clientX - rect.left) / rect.width) * canvasWidth,
			y: ((event.clientY - rect.top) / rect.height) * canvasHeight
		};
	}

	function resolvedTransform(): Required<
		Pick<ItemTransform, 'x' | 'y' | 'width' | 'height' | 'rotation'>
	> &
		ItemTransform {
		return {
			...transform,
			x: transform.x ?? 0,
			y: transform.y ?? 0,
			width,
			height,
			rotation
		};
	}

	function setTool(tool: CanvasTool): void {
		if (tool === activeTool) return;
		if (textSession) finishText(true);
		cancelDrafts();
		activeTool = tool;
	}

	function cancelDrafts(): void {
		cancelActiveGesture?.();
		draftTransform = null;
		draftCrop = null;
		motionDraft = null;
		spatialDraft = null;
		snapLines = [];
		ontransformdraft(null);
		oncropdraft(null);
		ontextdraft(null);
		oncornerpindraft(null);
		if (textSession) {
			textSession = false;
			ontextediting(false);
		}
	}

	function attachPointerGesture(
		event: PointerEvent,
		onmove: (point: Point, event: PointerEvent) => void,
		oncommit: () => void,
		oncancel: () => void
	): void {
		event.preventDefault();
		event.stopPropagation();
		const pointerId = event.pointerId;
		const pointerTarget = event.currentTarget instanceof Element ? event.currentTarget : null;
		let finished = false;
		const move = (next: PointerEvent) => {
			if (next.pointerId !== pointerId) return;
			onmove(canvasPoint(next), next);
		};
		const cleanup = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', end);
			window.removeEventListener('pointercancel', cancel);
			window.removeEventListener('keydown', keydown);
			pointerTarget?.removeEventListener('lostpointercapture', lostCapture);
			if (pointerTarget?.hasPointerCapture(pointerId))
				pointerTarget.releasePointerCapture(pointerId);
			if (cancelActiveGesture === cancelGesture) cancelActiveGesture = null;
		};
		const end = (next: PointerEvent) => {
			if (finished || next.pointerId !== pointerId) return;
			finished = true;
			onmove(canvasPoint(next), next);
			cleanup();
			oncommit();
		};
		const cancel = (next?: PointerEvent) => {
			if (finished || (next && next.pointerId !== pointerId)) return;
			finished = true;
			cleanup();
			oncancel();
		};
		const keydown = (next: KeyboardEvent) => {
			if (next.key !== 'Escape') return;
			next.preventDefault();
			cancel();
		};
		const lostCapture = (next: Event) => {
			if (next instanceof PointerEvent) cancel(next);
			else cancel();
		};
		const cancelGesture = () => cancel();
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', end);
		window.addEventListener('pointercancel', cancel);
		window.addEventListener('keydown', keydown);
		pointerTarget?.addEventListener('lostpointercapture', lostCapture);
		try {
			pointerTarget?.setPointerCapture(pointerId);
		} catch {
			// Window listeners still own the gesture when capture is unavailable.
		}
		cancelActiveGesture = cancelGesture;
	}

	function startTransform(
		event: PointerEvent,
		operation: TransformOperation,
		handle?: TransformHandle
	): void {
		if (activeTool !== 'transform') return;
		const start = canvasPoint(event);
		const base = resolvedTransform();
		const resizeStart =
			operation === 'resize' && handle
				? transformHandlePoint({ transform: base, handle, canvasWidth, canvasHeight })
				: null;
		let moveAxis: 'x' | 'y' | null = null;
		const strokeExpansion = shapeStrokeExpansion(item);
		attachPointerGesture(
			event,
			(point, pointer) => {
				if (operation === 'move') {
					let dx = point.x - start.x;
					let dy = point.y - start.y;
					if (pointer.shiftKey) {
						moveAxis ??= Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
						if (moveAxis === 'x') dy = 0;
						else dx = 0;
					}
					const candidate = { ...base, x: base.x + dx, y: base.y + dy };
					if (snappingEnabled && !pointer.altKey) {
						const snapped = applyCanvasMoveSnapping({
							transform: candidate,
							canvasWidth,
							canvasHeight,
							currentSnapLines: snapLines,
							strokeExpansion,
							canvasScale: screenScale,
							otherItemBounds
						});
						draftTransform = snapped.transform;
						snapLines = snapped.snapLines;
					} else {
						draftTransform = candidate;
						snapLines = [];
					}
				} else if (operation === 'resize' && handle) {
					const maintainAspectRatio = aspectRatioLocked(pointer.shiftKey);
					const candidate = calculateTransformResize({
						startTransform: base,
						handle,
						startPoint: resizeStart ?? start,
						currentPoint: resizeStart
							? {
									x: resizeStart.x + point.x - start.x,
									y: resizeStart.y + point.y - start.y
								}
							: point,
						maintainAspectRatio,
						oppositeAnchored: pointer.ctrlKey,
						canvasWidth,
						canvasHeight
					});
					if (snappingEnabled && !pointer.altKey) {
						const snapped = applyCanvasResizeSnapping({
							transform: candidate,
							canvasWidth,
							canvasHeight,
							currentSnapLines: snapLines,
							strokeExpansion,
							canvasScale: screenScale,
							maintainAspectRatio
						});
						draftTransform = snapped.transform;
						snapLines = snapped.snapLines;
					} else {
						draftTransform = candidate;
						snapLines = [];
					}
				} else if (operation === 'rotate') {
					draftTransform = calculateTransformRotation({
						startTransform: base,
						startPoint: start,
						currentPoint: point,
						canvasWidth,
						canvasHeight,
						snap: snappingEnabled && !pointer.altKey
					});
					snapLines = [];
				}
				ontransformdraft(draftTransform);
			},
			() => {
				const next = draftTransform;
				if (next) {
					const values: CanvasAnimatedValues =
						operation === 'move'
							? { x: next.x, y: next.y }
							: operation === 'rotate'
								? { rotation: next.rotation }
								: {
										width: next.width,
										height: next.height,
										...(next.x !== base.x && { x: next.x }),
										...(next.y !== base.y && { y: next.y })
									};
					if (transformValuesChanged(values, base)) {
						const committed =
							operation === 'move' && hasMotion && next.x !== undefined && next.y !== undefined
								? oncommitposition(currentFrame, next.x, next.y)
								: oncommitvalues(currentFrame, values);
						if (committed) onedit();
					}
				}
				draftTransform = null;
				snapLines = [];
				ontransformdraft(null);
			},
			() => {
				draftTransform = null;
				snapLines = [];
				ontransformdraft(null);
			}
		);
	}

	function snapTransform(source: ItemTransform): SnapTransform {
		return {
			...source,
			x: source.x ?? 0,
			y: source.y ?? 0,
			width: Math.max(MIN_TRANSFORM_SIZE, source.width ?? canvasWidth),
			height: Math.max(MIN_TRANSFORM_SIZE, source.height ?? canvasHeight),
			rotation: source.rotation ?? 0
		};
	}

	function shapeStrokeExpansion(candidate: TimelineItem): number {
		return candidate.type === 'shape' && candidate.strokeEnabled ? (candidate.strokeWidth ?? 0) : 0;
	}

	function snapLineLabel(label: CanvasSnapLabel): string {
		if (label === 'edge') return m.video_editor_canvas_snap_edge();
		if (label === 'align') return m.video_editor_canvas_snap_align();
		if (label === 'center') return m.video_editor_canvas_snap_center();
		return label;
	}

	function aspectRatioLocked(shiftKey: boolean): boolean {
		const locked = transform.aspectRatioLocked ?? item.type !== 'text';
		return shiftKey ? !locked : locked;
	}

	function commitKeyboardTransform(values: CanvasAnimatedValues): void {
		if (!transformValuesChanged(values, resolvedTransform())) return;
		const committed =
			values.x !== undefined &&
			values.y !== undefined &&
			hasMotion &&
			Object.keys(values).length === 2
				? oncommitposition(currentFrame, values.x, values.y)
				: oncommitvalues(currentFrame, values);
		if (committed) onedit();
	}

	function transformValuesChanged(
		values: CanvasAnimatedValues,
		base: Required<Pick<ItemTransform, 'x' | 'y' | 'width' | 'height' | 'rotation'>>
	): boolean {
		const epsilon = 0.000001;
		return (
			(values.x !== undefined && Math.abs(values.x - base.x) > epsilon) ||
			(values.y !== undefined && Math.abs(values.y - base.y) > epsilon) ||
			(values.width !== undefined && Math.abs(values.width - base.width) > epsilon) ||
			(values.height !== undefined && Math.abs(values.height - base.height) > epsilon) ||
			(values.rotation !== undefined && Math.abs(values.rotation - base.rotation) > epsilon)
		);
	}

	function moveKeydown(event: KeyboardEvent): void {
		const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
		const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
		if (!dx && !dy) return;
		event.preventDefault();
		const base = resolvedTransform();
		const step = event.shiftKey ? 10 : 1;
		commitKeyboardTransform({ x: base.x + dx * step, y: base.y + dy * step });
	}

	function resizeKeydown(event: KeyboardEvent, handle: TransformHandle): void {
		const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
		const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
		if (!dx && !dy) return;
		event.preventDefault();
		const base = resolvedTransform();
		const step = event.shiftKey ? 10 : 1;
		const startPoint = transformHandlePoint({
			transform: base,
			handle,
			canvasWidth,
			canvasHeight
		});
		const next = calculateTransformResize({
			startTransform: base,
			handle,
			startPoint,
			currentPoint: { x: startPoint.x + dx * step, y: startPoint.y + dy * step },
			maintainAspectRatio: aspectRatioLocked(event.shiftKey),
			oppositeAnchored: event.ctrlKey,
			canvasWidth,
			canvasHeight
		});
		commitKeyboardTransform({
			width: next.width,
			height: next.height,
			...(next.x !== base.x && { x: next.x }),
			...(next.y !== base.y && { y: next.y })
		});
	}

	function rotationKeydown(event: KeyboardEvent): void {
		const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
		if (!direction) return;
		event.preventDefault();
		const base = resolvedTransform();
		const step = event.shiftKey ? 15 : 1;
		let next = base.rotation + direction * step;
		while (next > 180) next -= 360;
		while (next <= -180) next += 360;
		commitKeyboardTransform({ rotation: next });
	}

	function transformHandleStyle(handle: TransformHandle): string {
		const left = handle.includes('w') ? 0 : handle.includes('e') ? 100 : 50;
		const top = handle.includes('n') ? 0 : handle.includes('s') ? 100 : 50;
		return `left:${left}%;top:${top}%;transform:translate(-50%,-50%);cursor:${transformHandleCursor(handle, rotation)}`;
	}

	function transformHandleLabel(handle: TransformHandle): string {
		switch (handle) {
			case 'nw':
				return m.video_editor_resize_nw();
			case 'n':
				return m.video_editor_resize_n();
			case 'ne':
				return m.video_editor_resize_ne();
			case 'e':
				return m.video_editor_resize_e();
			case 'se':
				return m.video_editor_resize_se();
			case 's':
				return m.video_editor_resize_s();
			case 'sw':
				return m.video_editor_resize_sw();
			case 'w':
				return m.video_editor_resize_w();
		}
	}

	function cornerHandle(handle: TransformHandle): boolean {
		return handle.length === 2;
	}

	function startCrop(event: PointerEvent, edge: CropEdge): void {
		const start = canvasPoint(event);
		const startCrop = resolveCrop(item.crop);
		const sourceDimension =
			edge === 'left' || edge === 'right'
				? (item.sourceWidth ?? Math.round(width))
				: (item.sourceHeight ?? Math.round(height));
		attachPointerGesture(
			event,
			(point) => {
				draftCrop = calculateCropFromDrag({
					edge,
					startCrop,
					startPoint: start,
					currentPoint: point,
					rotation,
					mediaWidth: width,
					mediaHeight: height,
					sourceDimension
				});
				oncropdraft(draftCrop);
			},
			() => commitCrop(edge),
			() => {
				draftCrop = null;
				oncropdraft(null);
			}
		);
	}

	function commitCrop(edge: CropEdge): void {
		const next = draftCrop;
		if (next) {
			const property = CROP_EDGE_PROPERTY[edge];
			const sourceDimension =
				edge === 'left' || edge === 'right'
					? (item.sourceWidth ?? item.compositionWidth ?? Math.round(width))
					: (item.sourceHeight ?? item.compositionHeight ?? Math.round(height));
			if (oncommitvalues(currentFrame, { [property]: next[edge] * sourceDimension })) onedit();
		}
		draftCrop = null;
		oncropdraft(null);
	}

	function cropKeydown(event: KeyboardEvent, edge: CropEdge): void {
		const inward =
			(edge === 'left' && event.key === 'ArrowRight') ||
			(edge === 'right' && event.key === 'ArrowLeft') ||
			(edge === 'top' && event.key === 'ArrowDown') ||
			(edge === 'bottom' && event.key === 'ArrowUp');
		const outward =
			(edge === 'left' && event.key === 'ArrowLeft') ||
			(edge === 'right' && event.key === 'ArrowRight') ||
			(edge === 'top' && event.key === 'ArrowUp') ||
			(edge === 'bottom' && event.key === 'ArrowDown');
		if (!inward && !outward) return;
		event.preventDefault();
		const step = (event.shiftKey ? 10 : 1) * (inward ? 1 : -1);
		const start = { x: 0, y: 0 };
		const local =
			edge === 'left'
				? { x: step, y: 0 }
				: edge === 'right'
					? { x: -step, y: 0 }
					: edge === 'top'
						? { x: 0, y: step }
						: { x: 0, y: -step };
		const radians = (rotation * Math.PI) / 180;
		const world = {
			x: local.x * Math.cos(radians) - local.y * Math.sin(radians),
			y: local.x * Math.sin(radians) + local.y * Math.cos(radians)
		};
		draftCrop = calculateCropFromDrag({
			edge,
			startCrop: item.crop,
			startPoint: start,
			currentPoint: world,
			rotation,
			mediaWidth: width,
			mediaHeight: height,
			sourceDimension:
				edge === 'left' || edge === 'right'
					? (item.sourceWidth ?? Math.round(width))
					: (item.sourceHeight ?? Math.round(height))
		});
		commitCrop(edge);
	}

	function startAnchor(event: PointerEvent): void {
		const start = canvasPoint(event);
		const base = resolvedTransform();
		attachPointerGesture(
			event,
			(point) => {
				draftTransform = calculateAnchorDrag(base, start, point);
				ontransformdraft(draftTransform);
			},
			() => {
				const next = draftTransform;
				if (
					next &&
					oncommitvalues(currentFrame, {
						x: next.x,
						y: next.y,
						anchorX: next.anchorX,
						anchorY: next.anchorY
					})
				)
					onedit();
				draftTransform = null;
				ontransformdraft(null);
			},
			() => {
				draftTransform = null;
				ontransformdraft(null);
			}
		);
	}

	function anchorKeydown(event: KeyboardEvent): void {
		const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
		const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
		if (!dx && !dy) return;
		event.preventDefault();
		const step = event.shiftKey ? 10 : 1;
		const start = { x: 0, y: 0 };
		const next = calculateAnchorDrag(resolvedTransform(), start, {
			x: dx * step,
			y: dy * step
		});
		if (
			oncommitvalues(currentFrame, {
				x: next.x,
				y: next.y,
				anchorX: next.anchorX,
				anchorY: next.anchorY
			})
		)
			onedit();
	}

	function startTextSession(): void {
		if (textSession) return;
		textSession = true;
		draftText = item.text ?? '';
		ontextdraft(draftText);
		ontextediting(true);
		requestAnimationFrame(() => {
			const editor = textEditor;
			if (!editor) return;
			populateTextEditor(editor);
			editor.focus();
			const selection = window.getSelection();
			const range = document.createRange();
			range.selectNodeContents(editor);
			selection?.removeAllRanges();
			selection?.addRange(range);
		});
	}

	function populateTextEditor(editor: HTMLDivElement): void {
		if (!item.textSpans?.length) {
			editor.textContent = draftText ?? '';
			return;
		}
		editor.replaceChildren(
			...item.textSpans.map((span) => {
				const line = document.createElement('div');
				line.textContent = span.text;
				line.style.fontFamily = `"${loadedTextFontFamily(span.fontFamily ?? item.fontFamily ?? 'Inter')}", sans-serif`;
				line.style.fontSize = `${((span.fontSize ?? item.fontSize ?? Math.max(18, height / 15)) / canvasWidth) * 100}cqw`;
				line.style.fontWeight = String(span.fontWeight ?? item.fontWeight ?? 600);
				line.style.fontStyle = span.fontStyle ?? item.fontStyle ?? 'normal';
				line.style.letterSpacing = `${((span.letterSpacing ?? item.letterSpacing ?? 0) / canvasWidth) * 100}cqw`;
				line.style.color = span.color ?? item.color ?? '#ffffff';
				line.style.textDecoration = (span.underline ?? item.underline) ? 'underline' : 'none';
				return line;
			})
		);
	}

	function updateText(value: string): void {
		draftText = value;
		ontextdraft(value);
	}

	function finishText(commit: boolean): void {
		if (!textSession) return;
		const value = draftText ?? item.text ?? '';
		textSession = false;
		ontextediting(false);
		ontextdraft(null);
		draftText = null;
		if (commit && value !== (item.text ?? '')) {
			oncommittext(value);
			onedit();
		}
	}

	function textKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			cancellingText = true;
			finishText(false);
			activeTool = 'transform';
			requestAnimationFrame(() => (cancellingText = false));
		} else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			finishText(true);
			activeTool = 'transform';
		}
	}

	function pastePlainText(event: ClipboardEvent): void {
		event.preventDefault();
		const text = event.clipboardData?.getData('text/plain') ?? '';
		const selection = window.getSelection();
		if (!selection?.rangeCount) return;
		const range = selection.getRangeAt(0);
		range.deleteContents();
		const node = document.createTextNode(text);
		range.insertNode(node);
		range.setStartAfter(node);
		range.collapse(true);
		selection.removeAllRanges();
		selection.addRange(range);
		updateText(textEditor?.innerText ?? '');
	}

	function startMotionPoint(event: PointerEvent, point: MotionPathPoint): void {
		activeMotionFrame = point.frame;
		onseek(point.frame);
		const start = canvasPoint(event);
		let axis: 'x' | 'y' | null = null;
		attachPointerGesture(
			event,
			(current, pointer) => {
				let dx = current.x - start.x;
				let dy = current.y - start.y;
				if (pointer.shiftKey) {
					axis ??= Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
					if (axis === 'x') dy = 0;
					else dx = 0;
				}
				motionDraft = {
					frame: point.frame,
					x: point.x + dx - canvasWidth / 2,
					y: point.y + dy - canvasHeight / 2
				};
			},
			() => {
				if (motionDraft && oncommitposition(motionDraft.frame, motionDraft.x, motionDraft.y))
					onedit();
				motionDraft = null;
			},
			() => (motionDraft = null)
		);
	}

	function createMotionHandles(event: MouseEvent, point: MotionPathPoint): void {
		event.preventDefault();
		event.stopPropagation();
		activeMotionFrame = point.frame;
		onseek(point.frame);
		if (!point.spatial && oncreatespatial(point.frame)) onedit();
	}

	function startMotionHandle(
		event: PointerEvent,
		point: MotionPathPoint,
		handle: 'in' | 'out'
	): void {
		if (!point.spatial) return;
		event.stopPropagation();
		activeMotionFrame = point.frame;
		onseek(point.frame);
		const start = canvasPoint(event);
		const initial = handle === 'in' ? point.spatial.inTangent : point.spatial.outTangent;
		attachPointerGesture(
			event,
			(current, pointer) => {
				let tangent = {
					x: initial.x + current.x - start.x,
					y: initial.y + current.y - start.y
				};
				if (pointer.shiftKey) {
					if (Math.abs(tangent.x) >= Math.abs(tangent.y)) tangent = { x: tangent.x, y: 0 };
					else tangent = { x: 0, y: tangent.y };
				}
				const base = pointer.altKey ? { ...point.spatial!, continuous: false } : point.spatial!;
				spatialDraft = {
					frame: point.frame,
					spatial: withSpatialTangent(base, handle, tangent)
				};
			},
			() => {
				if (spatialDraft && oncommitspatial(spatialDraft.frame, spatialDraft.spatial)) onedit();
				spatialDraft = null;
			},
			() => (spatialDraft = null)
		);
	}

	function motionHandleKeydown(
		event: KeyboardEvent,
		point: MotionPathPoint,
		handle: 'in' | 'out'
	): void {
		if (!point.spatial) return;
		const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
		const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
		if (!dx && !dy) return;
		event.preventDefault();
		const step = event.shiftKey ? 10 : 1;
		const current = handle === 'in' ? point.spatial.inTangent : point.spatial.outTangent;
		const base = event.altKey ? { ...point.spatial, continuous: false } : point.spatial;
		if (
			oncommitspatial(
				point.frame,
				withSpatialTangent(base, handle, {
					x: current.x + dx * step,
					y: current.y + dy * step
				})
			)
		)
			onedit();
	}

	function toggleMotionContinuity(
		event: MouseEvent,
		point: MotionPathPoint,
		handle: 'in' | 'out'
	): void {
		event.preventDefault();
		event.stopPropagation();
		if (!point.spatial) return;
		const tangent = handle === 'in' ? point.spatial.inTangent : point.spatial.outTangent;
		const next = point.spatial.continuous
			? { ...point.spatial, continuous: false }
			: withSpatialTangent({ ...point.spatial, continuous: true }, handle, tangent);
		if (oncommitspatial(point.frame, next)) onedit();
	}

	function motionKeydown(event: KeyboardEvent, point: MotionPathPoint): void {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			onseek(point.frame);
			return;
		}
		const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
		const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
		if (!dx && !dy) return;
		event.preventDefault();
		const step = event.shiftKey ? 10 : 1;
		if (
			oncommitposition(
				point.frame,
				point.x - canvasWidth / 2 + dx * step,
				point.y - canvasHeight / 2 + dy * step
			)
		)
			onedit();
	}
</script>

<div bind:this={root} class="pointer-events-none absolute inset-0 z-20" data-on-canvas-tools>
	<div
		class="pointer-events-auto absolute top-2 left-1/2 z-30 flex max-w-[calc(100%_-_1rem)] -translate-x-1/2 gap-0.5 overflow-x-auto rounded-md border border-white/15 bg-black/80 p-0.5 text-[10px] text-white shadow-lg backdrop-blur"
		role="toolbar"
		aria-label={m.video_editor_canvas_tools()}
	>
		<button
			type="button"
			class:active={activeTool === 'transform'}
			class="min-h-11 shrink-0 rounded px-2 py-1 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white md:min-h-7 [&.active]:bg-[oklch(0.72_0.16_45)] [&.active]:text-black [@media(pointer:coarse)]:min-h-11"
			onclick={() => setTool('transform')}>{m.video_editor_canvas_tool_transform()}</button
		>
		{#if canCrop}
			<button
				type="button"
				class:active={activeTool === 'crop'}
				class="min-h-11 shrink-0 rounded px-2 py-1 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white md:min-h-7 [&.active]:bg-[oklch(0.72_0.16_45)] [&.active]:text-black [@media(pointer:coarse)]:min-h-11"
				onclick={() => setTool('crop')}>{m.video_editor_canvas_tool_crop()}</button
			>
		{/if}
		<button
			type="button"
			class:active={activeTool === 'anchor'}
			class="min-h-11 shrink-0 rounded px-2 py-1 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white md:min-h-7 [&.active]:bg-[oklch(0.72_0.16_45)] [&.active]:text-black [@media(pointer:coarse)]:min-h-11"
			onclick={() => setTool('anchor')}>{m.video_editor_canvas_tool_anchor()}</button
		>
		{#if canEditText}
			<button
				type="button"
				class:active={activeTool === 'text'}
				class="min-h-11 shrink-0 rounded px-2 py-1 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white md:min-h-7 [&.active]:bg-[oklch(0.72_0.16_45)] [&.active]:text-black [@media(pointer:coarse)]:min-h-11"
				onclick={() => setTool('text')}>{m.video_editor_canvas_tool_text()}</button
			>
		{/if}
		{#if hasMotion && !isPlaying}
			<button
				type="button"
				class:active={activeTool === 'motion'}
				class="min-h-11 shrink-0 rounded px-2 py-1 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white md:min-h-7 [&.active]:bg-[oklch(0.72_0.16_45)] [&.active]:text-black [@media(pointer:coarse)]:min-h-11"
				onclick={() => setTool('motion')}>{m.video_editor_canvas_tool_motion()}</button
			>
		{/if}
		{#if canEditPath && !isPlaying}
			<button
				type="button"
				class:active={activeTool === 'path'}
				class="min-h-11 shrink-0 rounded px-2 py-1 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white md:min-h-7 [&.active]:bg-[oklch(0.72_0.16_45)] [&.active]:text-black [@media(pointer:coarse)]:min-h-11"
				onclick={() => setTool('path')}>{m.video_editor_canvas_tool_path()}</button
			>
		{/if}
		{#if canCornerPin && !isPlaying}
			<button
				type="button"
				class:active={activeTool === 'corner-pin'}
				class="min-h-11 shrink-0 rounded px-2 py-1 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white md:min-h-7 [&.active]:bg-[oklch(0.76_0.13_220)] [&.active]:text-black [@media(pointer:coarse)]:min-h-11"
				onclick={() => setTool('corner-pin')}>{m.video_editor_canvas_tool_corner_pin()}</button
			>
		{/if}
	</div>

	{#each snapLines as line (`${line.type}:${line.position}`)}
		<div
			class="pointer-events-none absolute z-20 bg-[oklch(0.76_0.16_340)] shadow-[0_0_5px_oklch(0.76_0.16_340)]"
			class:h-px={line.type === 'horizontal'}
			class:w-full={line.type === 'horizontal'}
			class:w-px={line.type === 'vertical'}
			class:h-full={line.type === 'vertical'}
			style:left={line.type === 'vertical' ? `${(line.position / canvasWidth) * 100}%` : '0'}
			style:top={line.type === 'horizontal' ? `${(line.position / canvasHeight) * 100}%` : '0'}
			data-canvas-snap-guide={line.type}
			data-canvas-snap-position={line.position}
		>
			{#if line.label}
				<span
					class="absolute top-1 left-1 rounded-sm bg-[oklch(0.76_0.16_340)] px-1 py-0.5 text-[10px] leading-none font-semibold whitespace-nowrap text-white shadow-sm"
				>
					{snapLineLabel(line.label)}
				</span>
			{/if}
		</div>
	{/each}

	{#if activeTool === 'motion' && !isPlaying && motionPoints.length > 0}
		<svg
			class="absolute inset-0 size-full overflow-visible"
			viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
			aria-label={m.video_editor_motion_path()}
		>
			<polyline
				points={motionPoints.map((point) => `${point.x},${point.y}`).join(' ')}
				fill="none"
				stroke="black"
				stroke-width="5"
				stroke-linecap="round"
				stroke-linejoin="round"
				vector-effect="non-scaling-stroke"
			></polyline>
			<polyline
				points={motionPoints.map((point) => `${point.x},${point.y}`).join(' ')}
				fill="none"
				stroke="oklch(0.78 0.16 45)"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				vector-effect="non-scaling-stroke"
			></polyline>
			{#if activeMotionPoint?.spatial && activeMotionPoint.inHandle && activeMotionPoint.outHandle}
				<line
					x1={activeMotionPoint.inHandle.x}
					y1={activeMotionPoint.inHandle.y}
					x2={activeMotionPoint.outHandle.x}
					y2={activeMotionPoint.outHandle.y}
					stroke="black"
					stroke-width="4"
					vector-effect="non-scaling-stroke"
				></line>
				<line
					x1={activeMotionPoint.inHandle.x}
					y1={activeMotionPoint.inHandle.y}
					x2={activeMotionPoint.outHandle.x}
					y2={activeMotionPoint.outHandle.y}
					stroke="white"
					stroke-width="1.5"
					vector-effect="non-scaling-stroke"
				></line>
				{#each ['in', 'out'] as handle}
					{@const handlePoint =
						handle === 'in' ? activeMotionPoint.inHandle : activeMotionPoint.outHandle}
					<circle
						class="pointer-events-none"
						cx={handlePoint.x}
						cy={handlePoint.y}
						r={4 / screenScale}
						fill="white"
						stroke="black"
						stroke-width="2"
						vector-effect="non-scaling-stroke"
					></circle>
					<circle
						class="pointer-events-auto cursor-crosshair focus:outline-none focus-visible:stroke-[oklch(0.78_0.16_45)]"
						cx={handlePoint.x}
						cy={handlePoint.y}
						r={12 / screenScale}
						fill="transparent"
						stroke="transparent"
						stroke-width="2"
						vector-effect="non-scaling-stroke"
						role="button"
						tabindex="0"
						aria-label={handle === 'in'
							? m.video_editor_motion_in_tangent({ frame: activeMotionPoint.frame })
							: m.video_editor_motion_out_tangent({ frame: activeMotionPoint.frame })}
						onpointerdown={(event) =>
							startMotionHandle(event, activeMotionPoint, handle as 'in' | 'out')}
						ondblclick={(event) =>
							toggleMotionContinuity(event, activeMotionPoint, handle as 'in' | 'out')}
						onkeydown={(event) =>
							motionHandleKeydown(event, activeMotionPoint, handle as 'in' | 'out')}
						><title>{m.video_editor_motion_tangent_hint()}</title></circle
					>
				{/each}
			{/if}
			{#each motionPoints.filter((point) => point.isKeyframe) as point (point.frame)}
				<circle
					class="pointer-events-none"
					cx={point.x}
					cy={point.y}
					r={4 / screenScale}
					fill="oklch(0.78 0.16 45)"
					stroke="black"
					stroke-width="2"
					vector-effect="non-scaling-stroke"
				></circle>
				<circle
					class="pointer-events-auto cursor-move focus:outline-none focus-visible:stroke-white"
					cx={point.x}
					cy={point.y}
					r={12 / screenScale}
					fill="transparent"
					stroke="transparent"
					stroke-width="2"
					vector-effect="non-scaling-stroke"
					role="button"
					tabindex="0"
					aria-label={m.video_editor_motion_keyframe({ frame: point.frame })}
					onpointerdown={(event) => startMotionPoint(event, point)}
					ondblclick={(event) => createMotionHandles(event, point)}
					onkeydown={(event) => motionKeydown(event, point)}
				></circle>
			{/each}
			<circle
				class="pointer-events-none"
				cx={currentTransform.x}
				cy={currentTransform.y}
				r={4 / screenScale}
				fill="white"
				stroke="black"
				stroke-width="2"
				vector-effect="non-scaling-stroke"
			></circle>
		</svg>
	{:else if activeTool === 'path' && canEditPath && !isPlaying}
		<PathEditorOverlay
			{item}
			{canvasWidth}
			{canvasHeight}
			{currentFrame}
			{boxStyle}
			{screenScale}
			{onedit}
		/>
	{:else if activeTool === 'corner-pin' && canCornerPin && !isPlaying}
		<CornerPinOverlay
			{item}
			{canvasWidth}
			{canvasHeight}
			{boxStyle}
			{screenScale}
			onpreview={oncornerpindraft}
			oncommit={(pin) => {
				oncommitcornerpin(pin);
				onedit();
			}}
		/>
	{:else}
		<div
			class="pointer-events-auto absolute border border-[oklch(0.72_0.16_45)] shadow-[0_0_0_1px_black]"
			style={boxStyle}
			role="presentation"
			data-canvas-item-box
		>
			{#if activeTool === 'transform'}
				<button
					type="button"
					class="absolute inset-0 z-0 cursor-move bg-transparent focus-visible:outline-2 focus-visible:outline-white"
					class:cursor-text={canEditText}
					aria-label={m.video_editor_move_selected()}
					onpointerdown={(event) => startTransform(event, 'move')}
					onkeydown={moveKeydown}
					ondblclick={() => canEditText && setTool('text')}
				></button>
				{#each TRANSFORM_HANDLES as handle}
					<button
						type="button"
						class="absolute z-10 flex size-8 items-center justify-center rounded-full bg-transparent focus-visible:outline-2 focus-visible:outline-white"
						style={transformHandleStyle(handle)}
						aria-label={transformHandleLabel(handle)}
						title={m.video_editor_resize_modifier_hint()}
						data-transform-handle={handle}
						onpointerdown={(event) => startTransform(event, 'resize', handle)}
						onkeydown={(event) => resizeKeydown(event, handle)}
					>
						<span
							class="border border-black bg-[oklch(0.72_0.16_45)] shadow-[0_0_0_1px_white]"
							class:size-3={cornerHandle(handle)}
							class:h-2={handle === 'n' || handle === 's'}
							class:w-5={handle === 'n' || handle === 's'}
							class:h-5={handle === 'e' || handle === 'w'}
							class:w-2={handle === 'e' || handle === 'w'}
							class:rounded-sm={!cornerHandle(handle)}
						></span>
					</button>
				{/each}
				<button
					type="button"
					class="absolute left-1/2 z-10 flex size-8 -translate-1/2 cursor-crosshair items-center justify-center rounded-full bg-transparent focus-visible:outline-2 focus-visible:outline-white"
					style:top="-32px"
					aria-label={m.video_editor_rotate_selected()}
					title={m.video_editor_rotation_modifier_hint()}
					data-transform-handle="rotate"
					onpointerdown={(event) => startTransform(event, 'rotate')}
					onkeydown={rotationKeydown}
				>
					<span
						class="pointer-events-none absolute top-1/2 left-1/2 h-8 border-l border-dashed border-[oklch(0.72_0.16_45)] shadow-[1px_0_0_black]"
					></span>
					<span
						class="z-10 size-3 rounded-full border border-black bg-[oklch(0.72_0.16_45)] shadow-[0_0_0_1px_white]"
					></span>
				</button>
			{:else if activeTool === 'crop'}
				<div class="pointer-events-none absolute inset-0 bg-black/15"></div>
				{#each ['left', 'right', 'top', 'bottom'] as edge}
					<button
						type="button"
						role="slider"
						class:left-0={edge === 'left'}
						class:right-0={edge === 'right'}
						class:top-0={edge === 'top'}
						class:bottom-0={edge === 'bottom'}
						class="absolute z-10 flex items-center justify-center bg-transparent focus-visible:outline-2 focus-visible:outline-white"
						class:vertical-handle={edge === 'left' || edge === 'right'}
						class:horizontal-handle={edge === 'top' || edge === 'bottom'}
						aria-label={m.video_editor_crop_handle({ edge })}
						aria-valuemin="0"
						aria-valuemax="99.9"
						aria-valuenow={Math.round(((draftCrop ?? item.crop)?.[edge as CropEdge] ?? 0) * 100)}
						aria-valuetext={`${Math.round(((draftCrop ?? item.crop)?.[edge as CropEdge] ?? 0) * 100)}%`}
						aria-orientation={edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical'}
						onpointerdown={(event) => startCrop(event, edge as CropEdge)}
						onkeydown={(event) => cropKeydown(event, edge as CropEdge)}
					>
						<span
							class:vertical-grip={edge === 'left' || edge === 'right'}
							class:horizontal-grip={edge === 'top' || edge === 'bottom'}
						></span>
					</button>
				{/each}
			{:else if activeTool === 'anchor'}
				<div
					class="pointer-events-none absolute h-px bg-[oklch(0.78_0.16_45)] shadow-[0_0_0_1px_black]"
					style:left="50%"
					style:top="50%"
					style:width={`${Math.hypot(anchorX - width / 2, anchorY - height / 2)}px`}
					style:transform-origin="left center"
					style:transform={`rotate(${Math.atan2(anchorY - height / 2, anchorX - width / 2)}rad)`}
				></div>
				<button
					type="button"
					class="absolute flex size-9 -translate-1/2 cursor-crosshair items-center justify-center rounded-full bg-transparent focus-visible:outline-2 focus-visible:outline-white"
					style:left={`${(anchorX / width) * 100}%`}
					style:top={`${(anchorY / height) * 100}%`}
					aria-label={m.video_editor_anchor_handle()}
					onpointerdown={startAnchor}
					onkeydown={anchorKeydown}
				>
					<span
						class="size-5 rounded-full border-2 border-black bg-[oklch(0.78_0.16_45)] shadow-[0_0_0_1px_white]"
					></span>
				</button>
			{/if}
		</div>
	{/if}

	{#if activeTool === 'text' && canEditText}
		<div
			bind:this={textEditor}
			class="pointer-events-auto absolute z-10 flex overflow-hidden border border-[oklch(0.78_0.16_45)] bg-black/10 whitespace-pre-wrap text-white caret-[oklch(0.78_0.16_45)] shadow-[0_0_0_1px_black] focus:outline-none"
			style={boxStyle}
			style:font-family={`"${loadedTextFontFamily(item.fontFamily ?? 'Inter')}", sans-serif`}
			style:font-size={`${((item.fontSize ?? Math.max(18, height / 15)) / canvasWidth) * 100}cqw`}
			style:font-weight={item.fontWeight ?? 600}
			style:font-style={item.fontStyle ?? 'normal'}
			style:text-decoration={item.underline ? 'underline' : 'none'}
			style:line-height={item.lineHeight ?? 1.2}
			style:letter-spacing={`${((item.letterSpacing ?? 0) / canvasWidth) * 100}cqw`}
			style:text-align={item.textAlign ?? 'center'}
			style:color={item.color ?? '#ffffff'}
			style:background-color={item.textSpans?.length
				? 'transparent'
				: (item.backgroundColor ?? 'transparent')}
			style:border-radius={`${((item.borderRadius ?? 0) / canvasWidth) * 100}cqw`}
			style:padding={`${((item.paddingY ?? 0) / canvasHeight) * 100}cqh ${((item.paddingX ?? 0) / canvasWidth) * 100}cqw`}
			style:align-items={item.verticalAlign === 'top'
				? 'flex-start'
				: item.verticalAlign === 'bottom'
					? 'flex-end'
					: 'center'}
			contenteditable="plaintext-only"
			role="textbox"
			tabindex="0"
			aria-multiline="true"
			aria-label={m.video_editor_direct_text_editor()}
			oninput={(event) => updateText(event.currentTarget.innerText)}
			onpaste={pastePlainText}
			onkeydown={textKeydown}
			onblur={() => {
				if (!cancellingText) finishText(true);
			}}
		></div>
	{/if}
</div>

<style>
	.vertical-handle {
		top: 50%;
		width: 1.5rem;
		height: 2.75rem;
		transform: translateY(-50%);
		cursor: ew-resize;
	}

	.horizontal-handle {
		left: 50%;
		width: 2.75rem;
		height: 1.5rem;
		transform: translateX(-50%);
		cursor: ns-resize;
	}

	.vertical-grip {
		width: 0.5rem;
		height: 2rem;
		border: 1px solid black;
		border-radius: 0.125rem;
		background: oklch(0.78 0.16 45);
	}

	.horizontal-grip {
		width: 2rem;
		height: 0.5rem;
		border: 1px solid black;
		border-radius: 0.125rem;
		background: oklch(0.78 0.16 45);
	}
</style>
