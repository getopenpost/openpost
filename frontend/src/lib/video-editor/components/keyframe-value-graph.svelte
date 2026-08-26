<script lang="ts">
	import { onDestroy } from 'svelte';
	import FocusIcon from '@lucide/svelte/icons/focus';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import type {
		BezierControlPoints,
		EasingConfig,
		EasingType,
		KeyframeProperty,
		SpringParameters,
		TimelineItem
	} from '$lib/video-editor/project/types';
	import {
		duplicateKeyframes,
		removeKeyframes,
		setKeyframeEasing,
		updateKeyframes,
		type KeyframeEdit
	} from '$lib/video-editor/timeline/actions/keyframes';
	import {
		curvePath,
		editorKeyframes,
		GRAPH_PADDING,
		graphDimensions,
		graphPoint,
		graphValueRange,
		keyframeIdentity,
		marqueeSelection,
		editorPropertyLabel,
		editorPropertyValueRange,
		type EditorKeyframe,
		type GraphCoordinate,
		type GraphViewport,
		type MarqueeMode
	} from '$lib/video-editor/timeline/keyframe-editor';
	import { Button } from '$lib/components/ui/button';
	import { keyframeSelectionStore } from '$lib/video-editor/timeline/stores/keyframe-selection-store.svelte';
	import { transitionsStore } from '$lib/video-editor/timeline/actions/transitions-store.svelte';
	import { calculateTransitionPortions } from '$lib/video-editor/timeline/transition-planner';
	import { m } from '$lib/paraglide/messages';
	import {
		effectPropertyLabel,
		isColorEffectKeyframeProperty
	} from '$lib/video-editor/effects/effect-keyframes';
	import { keyframeValueToHexColor } from '$lib/video-editor/timeline/color-keyframes';
	import { BEZIER_PRESETS, buildEasingConfig } from '$lib/video-editor/timeline/easing-presets';
	import {
		EASING_PRESETS,
		SPRING_PRESETS,
		presetDirection,
		presetToEasing
	} from '$lib/video-editor/timeline/easings-dev-presets';
	import {
		loadCustomEasingPresets,
		saveCustomEasingPresets,
		upsertCustomEasingPreset,
		suggestedCustomPresetName,
		type CustomEasingPreset
	} from '$lib/video-editor/timeline/custom-easing-presets';
	import { DEFAULT_SPRING_PARAMS } from '$lib/video-editor/project/types';
	import {
		eventMatchesShortcut,
		resolveEditorShortcuts
	} from '$lib/video-editor/settings/keyboard-shortcuts';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	const EASING_SET = new Set<string>([
		'linear',
		'ease-in',
		'ease-out',
		'ease-in-out',
		'hold',
		'cubic-bezier',
		'spring'
	]);
	function isEasingType(value: string): value is EasingType {
		return EASING_SET.has(value);
	}

	let {
		item,
		property,
		currentFrame,
		onscrub,
		onselect = () => {},
		onedit
	}: {
		item: TimelineItem;
		property: KeyframeProperty;
		currentFrame: number;
		onscrub: (absoluteFrame: number) => void;
		onselect?: (keyframe: EditorKeyframe | null) => void;
		onedit: () => void;
	} = $props();

	const HEIGHT = 230;
	const DRAG_THRESHOLD = 3;
	const SNAP_THRESHOLD = 8;
	const HANDLE_HIT_RADIUS = 14;
	const KEYFRAME_HIT_RADIUS = 9;

	let host = $state<HTMLDivElement | null>(null);
	let svg = $state<SVGSVGElement | null>(null);
	let width = $state(640);
	let viewport = $state<GraphViewport>({
		width: 640,
		height: HEIGHT,
		startFrame: 0,
		endFrame: 1,
		minValue: 0,
		maxValue: 1
	});
	const selectedIds = $derived(keyframeSelectionStore.forItem(item.id));
	let previewValues = $state<Record<string, { frame: number; value: number }> | null>(null);
	let previewBezierConfigs = $state<Record<string, BezierControlPoints> | null>(null);
	let snapGuides = $state<{ frame: number | null; value: number | null }>({
		frame: null,
		value: null
	});
	let marquee = $state<{ x: number; y: number; width: number; height: number } | null>(null);
	let segmentMenu = $state<{ leftFrame: number; easing: string } | null>(null);
	type SpringGesture = { frame: number; original: SpringParameters; draft: SpringParameters };
	let springGesture = $state<SpringGesture | null>(null);
	let presetType = $state<'Easing' | 'Spring'>('Easing');
	let direction = $state<'all' | 'in' | 'out' | 'inout'>('all');
	let showAllEasing = $state(false);
	let customPresets = $state<CustomEasingPreset[]>(loadCustomEasingPresets());
	let resetKey = '';

	type KeyframeDrag = {
		kind: 'keyframe';
		pointerId: number;
		startX: number;
		startY: number;
		anchorId: string;
		duplicate: boolean;
		started: boolean;
		initial: Map<string, EditorKeyframe>;
	};
	type MarqueeDrag = {
		kind: 'marquee';
		pointerId: number;
		startX: number;
		startY: number;
		mode: MarqueeMode;
		base: Set<string>;
		started: boolean;
	};
	type HandleDrag = {
		kind: 'handle';
		pointerId: number;
		start: EditorKeyframe;
		end: EditorKeyframe;
		handle: 'out' | 'in';
		initial: BezierControlPoints;
		startPoint: GraphCoordinate;
		endPoint: GraphCoordinate;
	};
	let drag = $state<KeyframeDrag | MarqueeDrag | HandleDrag | null>(null);

	const keyframes = $derived(editorKeyframes(item, property));
	const displayKeyframes = $derived(
		keyframes.map((keyframe) => {
			const preview = previewValues?.[keyframeIdentity(keyframe)];
			const bezierPreview = previewBezierConfigs?.[String(keyframe.frame)];
			let next: EditorKeyframe = { ...keyframe };
			if (preview) {
				next = { ...next, ...preview };
			}
			if (bezierPreview !== undefined) {
				next.easing = 'cubic-bezier';
				next.easingConfig = { type: 'cubic-bezier', bezier: bezierPreview };
			}
			if (springGesture && keyframe.frame === springGesture.frame) {
				next.easing = 'spring';
				next.easingConfig = { type: 'spring', spring: { ...springGesture.draft } };
			}
			return next;
		})
	);
	const sortedDisplay = $derived([...displayKeyframes].toSorted((a, b) => a.frame - b.frame));
	const points = $derived(
		displayKeyframes.map((keyframe) => ({
			keyframe,
			id: keyframeIdentity(keyframe),
			...graphPoint(keyframe.frame, keyframe.value, viewport)
		}))
	);
	const sortedPoints = $derived(
		[...points].toSorted((a, b) => a.keyframe.frame - b.keyframe.frame)
	);
	const relativePlayhead = $derived(
		Math.max(0, Math.min(item.durationInFrames - 1, currentFrame - item.from))
	);
	const playheadX = $derived(graphPoint(relativePlayhead, viewport.minValue, viewport).x);
	const dimensions = $derived(graphDimensions(viewport));
	const frameTicks = $derived.by(() => {
		const count = width < 380 ? 5 : 7;
		return Array.from({ length: count }, (_, index) => {
			const ratio = index / (count - 1);
			return {
				frame: Math.round(viewport.startFrame + ratio * dimensions.frameRange),
				x: dimensions.left + ratio * dimensions.width
			};
		});
	});
	const valueTicks = $derived(
		Array.from({ length: 5 }, (_, index) => {
			const ratio = index / 4;
			return {
				value: viewport.maxValue - ratio * dimensions.valueRange,
				y: dimensions.top + ratio * dimensions.height
			};
		})
	);
	const range = $derived(editorPropertyValueRange(item, property));
	const colorProperty = $derived(isColorEffectKeyframeProperty(property));
	const propertyLabel = $derived(
		effectPropertyLabel(item, property) ?? editorPropertyLabel(item, property)
	);
	const blockedRanges = $derived.by(() =>
		transitionsStore.list.flatMap((transition) => {
			const { leftPortion, rightPortion } = calculateTransitionPortions(
				transition.durationInFrames,
				transition.alignment
			);
			if (transition.fromItemId === item.id && leftPortion > 0) {
				return [{ start: item.durationInFrames - leftPortion, end: item.durationInFrames }];
			}
			if (transition.toItemId === item.id && rightPortion > 0) {
				return [{ start: 0, end: rightPortion }];
			}
			return [];
		})
	);
	const segmentSpans = $derived.by(() => {
		if (sortedDisplay.length < 2) return [];
		return sortedDisplay.slice(0, -1).map((start, index) => {
			const end = sortedDisplay[index + 1]!;
			const startPoint = graphPoint(start.frame, start.value, viewport);
			const endPoint = graphPoint(end.frame, end.value, viewport);
			const left = Math.min(startPoint.x, endPoint.x);
			const widthSpan = Math.abs(endPoint.x - startPoint.x);
			const midX = (startPoint.x + endPoint.x) / 2;
			const midY = (startPoint.y + endPoint.y) / 2;
			return { start, end, startPoint, endPoint, left, width: widthSpan, midX, midY, index };
		});
	});

	$effect(() => {
		if (!host) return;
		const observer = new ResizeObserver(([entry]) => {
			const nextWidth = Math.max(320, Math.round(entry?.contentRect.width ?? 640));
			width = nextWidth;
			viewport = { ...viewport, width: nextWidth };
		});
		observer.observe(host);
		return () => observer.disconnect();
	});

	$effect(() => {
		const nextResetKey = `${item.id}:${property}`;
		if (nextResetKey === resetKey) return;
		resetKey = nextResetKey;
		setSelection([]);
		previewValues = null;
		previewBezierConfigs = null;
		snapGuides = { frame: null, value: null };
		segmentMenu = null;
		fitToContent();
	});

	$effect(() => {
		keyframeSelectionStore.prune(
			item.id,
			new Set(keyframes.map((keyframe) => keyframeIdentity(keyframe)))
		);
	});

	onDestroy(() => {
		drag = null;
	});

	function fitToContent(): void {
		const valueRange = graphValueRange(property, editorKeyframes(item, property));
		viewport = {
			width,
			height: HEIGHT,
			startFrame: 0,
			endFrame: Math.max(1, item.durationInFrames - 1),
			minValue: valueRange.min,
			maxValue: valueRange.max
		};
	}

	function setSelection(ids: Iterable<string>): void {
		keyframeSelectionStore.replace(item.id, ids);
	}

	function clampViewport(next: GraphViewport): GraphViewport {
		const frameSpan = Math.max(
			1,
			Math.min(item.durationInFrames - 1, next.endFrame - next.startFrame)
		);
		let startFrame = Math.max(0, next.startFrame);
		let endFrame = startFrame + frameSpan;
		if (endFrame > item.durationInFrames - 1) {
			endFrame = item.durationInFrames - 1;
			startFrame = Math.max(0, endFrame - frameSpan);
		}
		const valueSpan = Math.max(
			0.0001,
			Math.min(range.max - range.min, next.maxValue - next.minValue)
		);
		let minValue = Math.max(range.min, next.minValue);
		let maxValue = minValue + valueSpan;
		if (maxValue > range.max) {
			maxValue = range.max;
			minValue = Math.max(range.min, maxValue - valueSpan);
		}
		return { ...next, startFrame, endFrame, minValue, maxValue };
	}

	function zoom(factor: number, focusFrame = relativePlayhead, focusValue?: number): void {
		const frameSpan = dimensions.frameRange * factor;
		const valueSpan = dimensions.valueRange * factor;
		const frameRatio = (focusFrame - viewport.startFrame) / dimensions.frameRange;
		const valueFocus = focusValue ?? (viewport.minValue + viewport.maxValue) / 2;
		const valueRatio = (valueFocus - viewport.minValue) / dimensions.valueRange;
		viewport = clampViewport({
			...viewport,
			startFrame: focusFrame - frameSpan * frameRatio,
			endFrame: focusFrame + frameSpan * (1 - frameRatio),
			minValue: valueFocus - valueSpan * valueRatio,
			maxValue: valueFocus + valueSpan * (1 - valueRatio)
		});
	}

	function localPoint(event: PointerEvent | WheelEvent): GraphCoordinate {
		const rect = svg?.getBoundingClientRect();
		return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
	}

	function selectPoint(point: (typeof points)[number], event: PointerEvent): Set<string> {
		const next = new Set(selectedIds);
		if (event.shiftKey) {
			if (next.has(point.id)) next.delete(point.id);
			else next.add(point.id);
		} else if (event.ctrlKey || event.metaKey) {
			next.add(point.id);
		} else if (!next.has(point.id)) {
			next.clear();
			next.add(point.id);
		}
		setSelection(next);
		onselect(point.keyframe);
		return next;
	}

	function capturePointer(pointerId: number): void {
		if (!svg) return;
		try {
			svg.setPointerCapture(pointerId);
		} catch {
			// Synthetic events and interrupted gestures may not own an active pointer.
		}
	}

	function startKeyframeDrag(point: (typeof points)[number], event: PointerEvent): void {
		if (event.button !== 0 || !svg) return;
		event.preventDefault();
		event.stopPropagation();
		const selection = selectPoint(point, event);
		const selected = points.filter((candidate) => selection.has(candidate.id));
		capturePointer(event.pointerId);
		drag = {
			kind: 'keyframe',
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			anchorId: point.id,
			duplicate: event.altKey,
			started: false,
			initial: new Map(selected.map((candidate) => [candidate.id, candidate.keyframe]))
		};
	}

	function startMarquee(event: PointerEvent): void {
		if (event.button !== 0 || !svg) return;
		// Ignore clicks on segment easing buttons
		// SAFETY: pointerdown target is an Element when handling a DOM event
		const target = event.target as HTMLElement | null;
		if (target?.closest('[data-segment-easing]')) return;
		const point = localPoint(event);
		const mode: MarqueeMode = event.shiftKey
			? 'add'
			: event.ctrlKey || event.metaKey
				? 'toggle'
				: 'replace';
		capturePointer(event.pointerId);
		drag = {
			kind: 'marquee',
			pointerId: event.pointerId,
			startX: point.x,
			startY: point.y,
			mode,
			base: new Set(selectedIds),
			started: false
		};
	}

	function dragKeyframes(event: PointerEvent, state: KeyframeDrag): void {
		const deltaX = event.clientX - state.startX;
		const deltaY = event.clientY - state.startY;
		if (!state.started && Math.hypot(deltaX, deltaY) <= DRAG_THRESHOLD) return;
		state.started = true;
		const anchor = state.initial.get(state.anchorId);
		if (!anchor) return;
		let frameDelta = (deltaX / dimensions.width) * dimensions.frameRange;
		let valueDelta = colorProperty ? 0 : -(deltaY / dimensions.height) * dimensions.valueRange;
		if (event.altKey && !state.duplicate) {
			frameDelta *= 0.5;
			valueDelta *= 0.5;
		}
		if (event.shiftKey && !colorProperty) {
			if (Math.abs(deltaX) >= Math.abs(deltaY)) valueDelta = 0;
			else frameDelta = 0;
		}
		let anchorFrame = Math.round(anchor.frame + frameDelta);
		let anchorValue = anchor.value + valueDelta;
		const minFrame = Math.min(...[...state.initial.values()].map((entry) => entry.frame));
		const maxFrame = Math.max(...[...state.initial.values()].map((entry) => entry.frame));
		anchorFrame = Math.max(anchor.frame - minFrame, anchorFrame);
		anchorFrame = Math.min(anchor.frame + item.durationInFrames - 1 - maxFrame, anchorFrame);
		anchorValue = Math.max(range.min, Math.min(range.max, anchorValue));

		let snappedFrame: number | null = null;
		let snappedValue: number | null = null;
		const snapEnabled = _snapEnabled && !event.ctrlKey && !event.metaKey;
		if (snapEnabled) {
			const frameThreshold = (SNAP_THRESHOLD / dimensions.width) * dimensions.frameRange;
			const valueThreshold = (SNAP_THRESHOLD / dimensions.height) * dimensions.valueRange;
			const frameTargets = [
				0,
				item.durationInFrames - 1,
				relativePlayhead,
				...blockedRanges.flatMap((r) => [r.start, r.end]),
				...keyframes
					.filter((keyframe) => !state.initial.has(keyframeIdentity(keyframe)))
					.map((keyframe) => keyframe.frame)
			];
			const valueTargets = [
				0,
				range.min,
				range.max,
				...(range.min <= 1 && range.max >= 1 ? [1] : []),
				...keyframes
					.filter((keyframe) => !state.initial.has(keyframeIdentity(keyframe)))
					.map((keyframe) => keyframe.value)
			];
			const beforeFrame = anchorFrame;
			anchorFrame = nearestSnap(anchorFrame, frameTargets, frameThreshold);
			if (anchorFrame !== beforeFrame) snappedFrame = anchorFrame;
			else {
				const nearFrame = frameTargets.find((t) => Math.abs(t - beforeFrame) <= frameThreshold);
				if (nearFrame !== undefined) snappedFrame = nearFrame;
			}
			if (!colorProperty) {
				const beforeValue = anchorValue;
				anchorValue = nearestSnap(anchorValue, valueTargets, valueThreshold);
				if (anchorValue !== beforeValue) snappedValue = anchorValue;
				else {
					const nearValue = valueTargets.find((t) => Math.abs(t - beforeValue) <= valueThreshold);
					if (nearValue !== undefined) snappedValue = nearValue;
				}
			}
		}
		snapGuides = { frame: snappedFrame, value: snappedValue };

		const requestedFrameDelta = anchorFrame - anchor.frame;
		const allowedFrameDeltas = [...state.initial.values()].map((initial) => {
			const target = clampAwayFromBlockedRange(initial.frame + requestedFrameDelta, initial.frame);
			return target - initial.frame;
		});
		const appliedFrameDelta =
			requestedFrameDelta > 0
				? Math.min(...allowedFrameDeltas)
				: requestedFrameDelta < 0
					? Math.max(...allowedFrameDeltas)
					: 0;
		const appliedValueDelta = anchorValue - anchor.value;
		previewValues = Object.fromEntries(
			[...state.initial].map(([id, initial]) => [
				id,
				{
					frame: Math.round(initial.frame + appliedFrameDelta),
					value: Math.max(range.min, Math.min(range.max, initial.value + appliedValueDelta))
				}
			])
		);
	}

	function clampAwayFromBlockedRange(frame: number, initialFrame: number): number {
		for (const blocked of blockedRanges) {
			if (frame < blocked.start || frame >= blocked.end) continue;
			if (initialFrame < blocked.start) return blocked.start - 1;
			if (initialFrame >= blocked.end) return blocked.end;
			return frame - blocked.start < blocked.end - frame ? blocked.start - 1 : blocked.end;
		}
		return frame;
	}

	function nearestSnap(value: number, targets: readonly number[], threshold: number): number {
		let result = value;
		let distance = threshold + 1e-9;
		for (const target of targets) {
			const candidateDistance = Math.abs(target - value);
			if (candidateDistance <= threshold && candidateDistance < distance) {
				distance = candidateDistance;
				result = target;
			} else if (candidateDistance <= threshold && candidateDistance === distance) {
				// Prefer the closest snap when multiple are at same distance; keep first.
				continue;
			}
		}
		return result;
	}

	function dragMarquee(event: PointerEvent, state: MarqueeDrag): void {
		const point = localPoint(event);
		if (
			!state.started &&
			Math.hypot(point.x - state.startX, point.y - state.startY) <= DRAG_THRESHOLD
		) {
			return;
		}
		state.started = true;
		const left = Math.min(state.startX, point.x);
		const right = Math.max(state.startX, point.x);
		const top = Math.min(state.startY, point.y);
		const bottom = Math.max(state.startY, point.y);
		const hits = points
			.filter(
				(candidate) =>
					candidate.x + KEYFRAME_HIT_RADIUS >= left &&
					candidate.x - KEYFRAME_HIT_RADIUS <= right &&
					candidate.y + KEYFRAME_HIT_RADIUS >= top &&
					candidate.y - KEYFRAME_HIT_RADIUS <= bottom
			)
			.map((candidate) => candidate.id);
		const selection = marqueeSelection(state.mode, state.base, hits);
		setSelection(selection);
		onselect(points.find((candidate) => selection.has(candidate.id))?.keyframe ?? null);
		marquee = {
			x: left,
			y: top,
			width: Math.max(1, right - left),
			height: Math.max(1, bottom - top)
		};
	}

	function dragHandle(event: PointerEvent, state: HandleDrag): void {
		const point = localPoint(event);
		const segmentWidth = state.endPoint.x - state.startPoint.x;
		const segmentHeight = state.endPoint.y - state.startPoint.y;
		if (segmentWidth === 0) return;
		let x = Math.max(0, Math.min(1, (point.x - state.startPoint.x) / segmentWidth));
		let y = segmentHeight === 0 ? 0.5 : (point.y - state.startPoint.y) / segmentHeight;
		if (event.shiftKey) {
			const initialX = state.handle === 'out' ? state.initial.x1 : state.initial.x2;
			const initialY = state.handle === 'out' ? state.initial.y1 : state.initial.y2;
			const anchorX = state.handle === 'out' ? 0 : 1;
			const anchorY = state.handle === 'out' ? 0 : 1;
			const directionX = initialX - anchorX;
			const directionY = initialY - anchorY;
			const lengthSquared = directionX * directionX + directionY * directionY;
			if (lengthSquared > 0) {
				const amount = ((x - anchorX) * directionX + (y - anchorY) * directionY) / lengthSquared;
				x = Math.max(0, Math.min(1, anchorX + directionX * amount));
				y = anchorY + directionY * amount;
			}
		}
		const nextBezier =
			state.handle === 'out'
				? { ...state.initial, x1: x, y1: y }
				: { ...state.initial, x2: x, y2: y };
		previewBezierConfigs = { [String(state.start.frame)]: nextBezier };
	}

	function onPointerMove(event: PointerEvent): void {
		if (!drag || drag.pointerId !== event.pointerId) return;
		if (drag.kind === 'keyframe') dragKeyframes(event, drag);
		else if (drag.kind === 'marquee') dragMarquee(event, drag);
		else dragHandle(event, drag);
	}

	function onPointerUp(event: PointerEvent): void {
		if (!drag || drag.pointerId !== event.pointerId) return;
		if (svg?.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
		if (drag.kind === 'keyframe' && drag.started && previewValues) {
			const edits: KeyframeEdit[] = [...drag.initial].flatMap(([id, initial]) => {
				const preview = previewValues?.[id];
				return preview ? [{ ref: initial, ...preview }] : [];
			});
			const changed = drag.duplicate
				? duplicateKeyframes(item.id, edits)
				: updateKeyframes(item.id, edits);
			if (changed) onedit();
			if (drag.duplicate) {
				setSelection([]);
				onselect(null);
			} else {
				const anchor = drag.initial.get(drag.anchorId);
				const target = anchor && previewValues?.[drag.anchorId];
				if (anchor && target) onselect({ ...anchor, ...target });
			}
		} else if (drag.kind === 'marquee' && !drag.started && drag.mode === 'replace') {
			setSelection([]);
			onselect(null);
		} else if (drag.kind === 'handle' && previewBezierConfigs) {
			const entry = Object.entries(previewBezierConfigs)[0];
			if (entry) {
				const [frameStr, bezier] = entry;
				// SAFETY: previewBezierConfigs keys are numeric frame strings
				const frame = Number(frameStr);
				const config: EasingConfig = { type: 'cubic-bezier', bezier };
				if (setKeyframeEasing(item.id, property, frame, 'cubic-bezier', config)) onedit();
			}
		}
		drag = null;
		previewValues = null;
		previewBezierConfigs = null;
		snapGuides = { frame: null, value: null };
		marquee = null;
	}

	function onPointerCancel(event: PointerEvent): void {
		if (!drag || drag.pointerId !== event.pointerId) return;
		if (svg?.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
		drag = null;
		previewValues = null;
		previewBezierConfigs = null;
		snapGuides = { frame: null, value: null };
		marquee = null;
	}

	function onWheel(event: WheelEvent): void {
		event.preventDefault();
		const point = localPoint(event);
		const focusFrame =
			viewport.startFrame +
			((point.x - dimensions.left) / dimensions.width) * dimensions.frameRange;
		const focusValue =
			viewport.maxValue - ((point.y - dimensions.top) / dimensions.height) * dimensions.valueRange;
		if (event.ctrlKey || event.metaKey) {
			zoom(event.deltaY > 0 ? 1.25 : 0.8, focusFrame, focusValue);
			return;
		}
		const horizontal = event.deltaX !== 0 ? event.deltaX : event.shiftKey ? event.deltaY : 0;
		if (horizontal !== 0) {
			const deltaFrames = (horizontal / dimensions.width) * dimensions.frameRange;
			viewport = clampViewport({
				...viewport,
				startFrame: viewport.startFrame + deltaFrames,
				endFrame: viewport.endFrame + deltaFrames
			});
			return;
		}
		const deltaValue = (event.deltaY / dimensions.height) * dimensions.valueRange;
		viewport = clampViewport({
			...viewport,
			minValue: viewport.minValue + deltaValue,
			maxValue: viewport.maxValue + deltaValue
		});
	}

	function onKeyDown(event: KeyboardEvent): void {
		const bindings = resolveEditorShortcuts();
		// Escape first cancels active gestures
		if (eventMatchesShortcut(event, bindings.GRAPH_CLEAR_SELECTION)) {
			const hadDrag = drag !== null;
			const hadPreview = previewValues !== null || previewBezierConfigs !== null;
			const hadMenu = segmentMenu !== null;
			if (hadDrag || hadPreview || hadMenu) {
				event.preventDefault();
				drag = null;
				previewValues = null;
				previewBezierConfigs = null;
				snapGuides = { frame: null, value: null };
				marquee = null;
				if (springGesture) {
					springGesture = null;
				}
				if (hadDrag || hadPreview) return;
				if (hadMenu) {
					segmentMenu = null;
					springGesture = null;
					return;
				}
			}
		}
		// Select all graph keyframes
		if (eventMatchesShortcut(event, bindings.GRAPH_SELECT_ALL)) {
			event.preventDefault();
			setSelection(points.map((point) => point.id));
			onselect(points[0]?.keyframe ?? null);
			return;
		}
		if (eventMatchesShortcut(event, bindings.GRAPH_CLEAR_SELECTION)) {
			// If no gesture was active, clear selection
			event.preventDefault();
			setSelection([]);
			onselect(null);
			return;
		}
		// Delete selected keyframes
		if (
			(eventMatchesShortcut(event, bindings.DELETE_SELECTED) ||
				eventMatchesShortcut(event, bindings.DELETE_SELECTED_ALT)) &&
			selectedIds.size > 0
		) {
			event.preventDefault();
			const refs = points
				.filter((point) => selectedIds.has(point.id))
				.map((point) => point.keyframe);
			if (removeKeyframes(item.id, refs)) onedit();
			setSelection([]);
			onselect(null);
			return;
		}
		const isLeft =
			eventMatchesShortcut(event, bindings.GRAPH_NUDGE_LEFT) ||
			eventMatchesShortcut(event, bindings.GRAPH_NUDGE_LEFT_FAST);
		const isRight =
			eventMatchesShortcut(event, bindings.GRAPH_NUDGE_RIGHT) ||
			eventMatchesShortcut(event, bindings.GRAPH_NUDGE_RIGHT_FAST);
		const isUp =
			eventMatchesShortcut(event, bindings.GRAPH_NUDGE_UP) ||
			eventMatchesShortcut(event, bindings.GRAPH_NUDGE_UP_FAST);
		const isDown =
			eventMatchesShortcut(event, bindings.GRAPH_NUDGE_DOWN) ||
			eventMatchesShortcut(event, bindings.GRAPH_NUDGE_DOWN_FAST);
		const isArrow = isLeft || isRight || isUp || isDown;
		if (!isArrow) return;
		if (colorProperty && (isUp || isDown)) return;
		const selected = points.filter((point) => selectedIds.has(point.id));
		if (selected.length === 0) return;
		event.preventDefault();
		const fast =
			eventMatchesShortcut(event, bindings.GRAPH_NUDGE_LEFT_FAST) ||
			eventMatchesShortcut(event, bindings.GRAPH_NUDGE_RIGHT_FAST) ||
			eventMatchesShortcut(event, bindings.GRAPH_NUDGE_UP_FAST) ||
			eventMatchesShortcut(event, bindings.GRAPH_NUDGE_DOWN_FAST);
		const multiplier = fast ? 10 : 1;
		const valueStep = 10 ** -range.decimals * multiplier;
		const edits = selected.map(({ keyframe }) => ({
			ref: keyframe,
			frame: keyframe.frame + (isLeft ? -multiplier : isRight ? multiplier : 0),
			value: keyframe.value + (isDown ? -valueStep : isUp ? valueStep : 0)
		}));
		if (updateKeyframes(item.id, edits)) onedit();
	}

	function onPointKeyDown(point: (typeof points)[number], event: KeyboardEvent): void {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			setSelection([point.id]);
			onselect(point.keyframe);
			onscrub(item.from + point.keyframe.frame);
			return;
		}
		if (!selectedIds.has(point.id)) {
			setSelection([point.id]);
			onselect(point.keyframe);
		}
		onKeyDown(event);
	}

	function easingBezier(keyframe: EditorKeyframe): BezierControlPoints | null {
		const preview = previewBezierConfigs?.[String(keyframe.frame)];
		if (preview) return preview;
		if (keyframe.easingConfig?.type === 'cubic-bezier') {
			return keyframe.easingConfig.bezier ?? null;
		}
		switch (keyframe.easing) {
			case 'ease-in':
				return { x1: 0.42, y1: 0, x2: 1, y2: 1 };
			case 'ease-out':
				return { x1: 0, y1: 0, x2: 0.58, y2: 1 };
			case 'ease-in-out':
				return { x1: 0.42, y1: 0, x2: 0.58, y2: 1 };
			default:
				return null;
		}
	}

	function easingLabel(keyframe: EditorKeyframe): string {
		switch (keyframe.easing) {
			case 'hold':
				return m.video_editor_keyframe_easing_hold();
			case 'ease-in':
				return m.video_editor_keyframe_easing_in();
			case 'ease-out':
				return m.video_editor_keyframe_easing_out();
			case 'ease-in-out':
				return m.video_editor_keyframe_easing_in_out();
			case 'cubic-bezier':
				return m.video_editor_keyframe_easing_bezier();
			case 'spring':
				return m.video_editor_keyframe_easing_spring();
			default:
				return m.video_editor_keyframe_easing_linear();
		}
	}
	function bezierPresetLocalizedLabel(value: string): string {
		switch (value) {
			case 'soft':
				return m.video_editor_keyframe_bezier_soft();
			case 'overshoot':
				return m.video_editor_keyframe_bezier_overshoot();
			case 'snap':
				return m.video_editor_keyframe_bezier_snap();
			case 'out-cubic':
				return m.video_editor_keyframe_bezier_out_cubic();
			case 'out-quart':
				return m.video_editor_keyframe_bezier_out_quart();
			case 'out-quint':
				return m.video_editor_keyframe_bezier_out_quint();
			case 'out-expo':
				return m.video_editor_keyframe_bezier_out_expo();
			case 'out-circ':
				return m.video_editor_keyframe_bezier_out_circ();
			default:
				return value;
		}
	}

	function startHandleDrag(
		start: EditorKeyframe,
		end: EditorKeyframe,
		handle: 'out' | 'in',
		bezier: BezierControlPoints,
		event: PointerEvent
	): void {
		if (!svg) return;
		event.preventDefault();
		event.stopPropagation();
		capturePointer(event.pointerId);
		const startPoint = graphPoint(start.frame, start.value, viewport);
		const endPoint = graphPoint(end.frame, end.value, viewport);
		drag = {
			kind: 'handle',
			pointerId: event.pointerId,
			start,
			end,
			handle,
			initial: bezier,
			startPoint,
			endPoint
		};
		previewBezierConfigs = { [String(start.frame)]: bezier };
	}

	function scrub(event: PointerEvent): void {
		const point = localPoint(event);
		const frame = Math.round(
			viewport.startFrame + ((point.x - dimensions.left) / dimensions.width) * dimensions.frameRange
		);
		onscrub(item.from + Math.max(0, Math.min(item.durationInFrames - 1, frame)));
	}

	function handleSegmentEasingChange(frame: number, easing: string): void {
		if (!isEasingType(easing)) return;
		const easingType = easing;
		const existing = keyframes.find((k) => k.frame === frame)?.easingConfig;
		const config = buildEasingConfig(easingType, existing);
		// Keep menu open so spring/bezier details remain visible
		if (segmentMenu && segmentMenu.leftFrame === frame)
			segmentMenu = { ...segmentMenu, easing: easingType };
		if (easingType === 'spring') {
			const spring =
				config?.type === 'spring' && config.spring ? config.spring : DEFAULT_SPRING_PARAMS;
			springGesture = { frame, original: { ...spring }, draft: { ...spring } };
		}
		if (setKeyframeEasing(item.id, property, frame, easingType, config)) onedit();
	}

	function beginSpringGesture(frame: number): void {
		if (springGesture && springGesture.frame === frame) return;
		const current = keyframes.find((k) => k.frame === frame)?.easingConfig?.spring;
		const original = current ? { ...current } : { ...DEFAULT_SPRING_PARAMS };
		const draft = keyframes.find((k) => k.frame === frame)?.easingConfig?.spring ?? {
			...DEFAULT_SPRING_PARAMS
		};
		// If draft already exists for this frame, keep it, otherwise use current
		const initialDraft = springGesture?.frame === frame ? springGesture.draft : draft;
		springGesture = { frame, original, draft: { ...initialDraft } };
	}
	function segmentSpringDraftChange(field: keyof SpringParameters, value: number): void {
		if (!springGesture) {
			if (!segmentMenu) return;
			beginSpringGesture(segmentMenu.leftFrame);
		}
		if (!springGesture) return;
		springGesture = { ...springGesture, draft: { ...springGesture.draft, [field]: value } };
	}
	function commitSegmentSpring(frame: number): void {
		if (!springGesture || springGesture.frame !== frame) return;
		const current = keyframes.find((k) => k.frame === frame)?.easingConfig?.spring;
		const draft = springGesture.draft;
		const original = springGesture.original;
		const noChange =
			current &&
			draft.tension === current.tension &&
			draft.friction === current.friction &&
			draft.mass === current.mass;
		// Clear gesture before commit to ensure later lostpointercapture is no-op
		springGesture = null;
		if (noChange) return;
		// Also check against original to avoid no-op commits when draft equals original and current equals original
		if (
			draft.tension === original.tension &&
			draft.friction === original.friction &&
			draft.mass === original.mass &&
			current &&
			current.tension === original.tension &&
			current.friction === original.friction &&
			current.mass === original.mass
		)
			return;
		const config: EasingConfig = { type: 'spring', spring: { ...draft } };
		if (setKeyframeEasing(item.id, property, frame, 'spring', config)) onedit();
	}
	function cancelSegmentSpring(frame: number): void {
		if (!springGesture || springGesture.frame !== frame) return;
		springGesture = null;
	}

	function segmentBezierPreset(frame: number, preset: string): void {
		const found = BEZIER_PRESETS.find((p) => p.value === preset);
		if (!found) return;
		const config: EasingConfig = { type: 'cubic-bezier', bezier: { ...found.points } };
		if (setKeyframeEasing(item.id, property, frame, 'cubic-bezier', config)) onedit();
	}

	function formatValue(value: number): string {
		if (colorProperty) return keyframeValueToHexColor(value);
		return `${value.toFixed(range.decimals)}${range.unit}`;
	}

	const _snapEnabled = $derived(timelineStore.snapEnabled);
</script>

<div
	bind:this={host}
	class="border-t border-[oklch(0.25_0.015_55)] bg-[oklch(0.13_0.008_55)]"
	data-keyframe-value-graph
>
	<div
		class="flex min-h-8 flex-wrap items-center gap-1 border-b border-[oklch(0.22_0.01_50)] px-2 py-1"
	>
		<span
			class="mr-auto min-w-0 flex-1 truncate text-[10px] font-medium text-[oklch(0.72_0.02_55)] capitalize"
		>
			{m.video_editor_keyframe_graph_title({ property: propertyLabel })}
		</span>
		<span class="hidden shrink-0 font-mono text-[9px] text-[oklch(0.62_0.015_55)] sm:inline">
			{m.video_editor_keyframe_graph_selected({ count: selectedIds.size })}
		</span>
		<span class="shrink-0 font-mono text-[9px] text-[oklch(0.62_0.015_55)] sm:hidden"
			>{selectedIds.size}</span
		>
		{#if !_snapEnabled}
			<span
				class="rounded bg-[oklch(0.66_0.14_45/0.15)] px-1.5 py-0.5 text-[9px] text-[oklch(0.78_0.15_45)]"
				>{m.video_editor_keyframe_graph_snap_off()}</span
			>
		{/if}
		<Button
			variant="ghost"
			size="icon"
			class="size-7 min-h-7 min-w-7 shrink-0 rounded sm:size-6"
			aria-label={m.video_editor_zoom_out()}
			title={m.video_editor_zoom_out()}
			onclick={() => zoom(1.25)}
		>
			<MinusIcon class="size-3" />
		</Button>
		<Button
			variant="ghost"
			size="icon"
			class="size-7 min-h-7 min-w-7 shrink-0 rounded sm:size-6"
			aria-label={m.video_editor_zoom_in()}
			title={m.video_editor_zoom_in()}
			onclick={() => zoom(0.8)}
		>
			<PlusIcon class="size-3" />
		</Button>
		<Button
			variant="ghost"
			size="icon"
			class="size-7 min-h-7 min-w-7 shrink-0 rounded sm:size-6"
			aria-label={m.video_editor_keyframe_graph_fit()}
			title={m.video_editor_keyframe_graph_fit()}
			onclick={fitToContent}
		>
			<FocusIcon class="size-3" />
		</Button>
	</div>

	<!-- The graph is one composite keyboard widget. Svelte's static-role table does not classify ARIA application as interactive. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		role="application"
		aria-label={m.video_editor_keyframe_graph_aria({ property: propertyLabel })}
		tabindex="0"
		class="focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[oklch(0.66_0.14_45)]"
		onkeydown={onKeyDown}
		onwheel={onWheel}
	>
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<svg
			bind:this={svg}
			class="block w-full touch-none select-none"
			style="height:{HEIGHT}px"
			viewBox="0 0 {width} {HEIGHT}"
			role="group"
			aria-label={m.video_editor_keyframe_graph_canvas()}
			onpointerdown={startMarquee}
			onpointermove={onPointerMove}
			onpointerup={onPointerUp}
			onpointercancel={onPointerCancel}
		>
			<rect {width} height={HEIGHT} fill="oklch(0.125 0.008 55)" />
			<g aria-hidden="true" class="pointer-events-none">
				<defs>
					<pattern
						id="keyframe-transition-blocked"
						width="6"
						height="6"
						patternUnits="userSpaceOnUse"
					>
						<path d="M -1 1 L 1 -1 M 0 6 L 6 0 M 5 7 L 7 5" stroke="oklch(0.66 0.14 45 / 0.35)" />
					</pattern>
				</defs>
				{#each frameTicks as tick, index (index)}
					<line
						x1={tick.x}
						x2={tick.x}
						y1={dimensions.top}
						y2={dimensions.top + dimensions.height}
						stroke="oklch(0.25 0.012 55)"
						stroke-width="1"
					/>
					<text
						x={tick.x}
						y={HEIGHT - 8}
						text-anchor="middle"
						fill="oklch(0.58 0.014 55)"
						font-size="9"
						font-family="monospace">{tick.frame}</text
					>
				{/each}
				{#each valueTicks as tick, index (index)}
					<line
						x1={dimensions.left}
						x2={dimensions.left + dimensions.width}
						y1={tick.y}
						y2={tick.y}
						stroke="oklch(0.25 0.012 55)"
						stroke-width="1"
					/>
					<text
						x={dimensions.left - 5}
						y={tick.y + 3}
						text-anchor="end"
						fill="oklch(0.58 0.014 55)"
						font-size="9"
						font-family="monospace">{formatValue(tick.value)}</text
					>
				{/each}
				{#each blockedRanges as blocked, index (`${blocked.start}:${blocked.end}:${index}`)}
					{@const start = graphPoint(blocked.start, viewport.minValue, viewport).x}
					{@const end = graphPoint(blocked.end, viewport.minValue, viewport).x}
					<rect
						x={Math.max(dimensions.left, start)}
						y={dimensions.top}
						width={Math.max(
							0,
							Math.min(dimensions.left + dimensions.width, end) - Math.max(dimensions.left, start)
						)}
						height={dimensions.height}
						fill="url(#keyframe-transition-blocked)"
						data-transition-blocked-range
					/>
				{/each}
			</g>

			{#if snapGuides.frame !== null}
				{@const gx = graphPoint(snapGuides.frame, viewport.minValue, viewport).x}
				<line
					x1={gx}
					x2={gx}
					y1={dimensions.top}
					y2={dimensions.top + dimensions.height}
					stroke="oklch(0.78 0.15 45)"
					stroke-width="1"
					stroke-dasharray="4 3"
					opacity="0.9"
					data-snap-guide="frame"
				/>
				<text
					x={gx + 4}
					y={dimensions.top + 10}
					fill="oklch(0.78 0.15 45)"
					font-size="8"
					font-family="monospace"
				>
					{m.video_editor_keyframe_graph_snap_frame({ frame: snapGuides.frame })}
				</text>
			{/if}
			{#if snapGuides.value !== null && !colorProperty}
				{@const gy = graphPoint(0, snapGuides.value, viewport).y}
				<line
					x1={dimensions.left}
					x2={dimensions.left + dimensions.width}
					y1={gy}
					y2={gy}
					stroke="oklch(0.78 0.15 45)"
					stroke-width="1"
					stroke-dasharray="4 3"
					opacity="0.9"
					data-snap-guide="value"
				/>
				<text
					x={dimensions.left + 4}
					y={gy - 4}
					fill="oklch(0.78 0.15 45)"
					font-size="8"
					font-family="monospace"
				>
					{m.video_editor_keyframe_graph_snap_value({ value: formatValue(snapGuides.value) })}
				</text>
			{/if}

			{#if points[0]}
				<line
					x1={dimensions.left}
					x2={points[0].x}
					y1={points[0].y}
					y2={points[0].y}
					stroke="oklch(0.66 0.14 45 / 0.45)"
					stroke-dasharray="4 4"
				/>
			{/if}
			{#each points.slice(0, -1) as point, index (point.id)}
				{@const next = points[index + 1]}
				{#if next}
					<path
						data-keyframe-curve
						d={curvePath(point.keyframe, next.keyframe, viewport)}
						fill="none"
						stroke={selectedIds.has(point.id) || selectedIds.has(next.id)
							? 'oklch(0.78 0.15 45)'
							: 'oklch(0.66 0.14 45)'}
						stroke-width={selectedIds.has(point.id) || selectedIds.has(next.id) ? 2.5 : 1.5}
						stroke-linecap="round"
						stroke-linejoin="round"
						class="pointer-events-none"
					/>
				{/if}
			{/each}
			{#if points.at(-1)}
				{@const last = points.at(-1)!}
				<line
					x1={last.x}
					x2={dimensions.left + dimensions.width}
					y1={last.y}
					y2={last.y}
					stroke="oklch(0.66 0.14 45 / 0.45)"
					stroke-dasharray="4 4"
				/>
			{/if}

			{#each segmentSpans as span, index (`${span.start.frame}:${span.end.frame}:${index}`)}
				{@const label = easingLabel(span.start)}
				{@const isSelected =
					selectedIds.has(keyframeIdentity(span.start)) ||
					selectedIds.has(keyframeIdentity(span.end))}
				{@const isMenuOpen = segmentMenu?.leftFrame === span.start.frame}
				{@const shouldShow =
					span.width > 36 && (isSelected || isMenuOpen || sortedDisplay.length <= 8)}
				{#if shouldShow}
					<g data-segment-easing={span.start.frame}>
						<rect
							x={span.midX - 22}
							y={span.midY - 8}
							width="44"
							height="12"
							rx="6"
							fill={isMenuOpen ? 'oklch(0.66 0.14 45)' : 'oklch(0.22 0.01 50)'}
							stroke="oklch(0.35 0.02 55)"
							stroke-width="1"
							class="cursor-pointer"
							style="pointer-events: all"
							role="button"
							tabindex="0"
							aria-label={m.video_editor_keyframe_graph_segment_easing({ frame: span.start.frame })}
							onpointerdown={(e) => {
								e.stopPropagation();
								if (isMenuOpen) {
									segmentMenu = null;
									springGesture = null;
								} else {
									segmentMenu = { leftFrame: span.start.frame, easing: span.start.easing };
									const s = keyframes.find((k) => k.frame === span.start.frame)?.easingConfig
										?.spring;
									const spring = s ? { ...s } : { ...DEFAULT_SPRING_PARAMS };
									springGesture = {
										frame: span.start.frame,
										original: { ...spring },
										draft: { ...spring }
									};
								}
							}}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									e.stopPropagation();
									if (isMenuOpen) {
										segmentMenu = null;
										springGesture = null;
									} else {
										segmentMenu = { leftFrame: span.start.frame, easing: span.start.easing };
										const s = keyframes.find((k) => k.frame === span.start.frame)?.easingConfig
											?.spring;
										const spring = s ? { ...s } : { ...DEFAULT_SPRING_PARAMS };
										springGesture = {
											frame: span.start.frame,
											original: { ...spring },
											draft: { ...spring }
										};
									}
								}
							}}
						/>
						<text
							x={span.midX}
							y={span.midY + 2.5}
							text-anchor="middle"
							fill={isMenuOpen ? 'white' : 'oklch(0.78 0.02 55)'}
							font-size="6.5"
							font-weight="600"
							class="pointer-events-none select-none">{label.slice(0, 9)}</text
						>
					</g>
				{/if}
			{/each}

			{#each points.slice(0, -1) as point, index (point.id)}
				{@const next = points[index + 1]}
				{@const bezier = easingBezier(point.keyframe)}
				{#if next && bezier && (selectedIds.has(point.id) || selectedIds.has(next.id))}
					{@const outX = point.x + bezier.x1 * (next.x - point.x)}
					{@const outY = point.y + bezier.y1 * (next.y - point.y)}
					{@const inX = point.x + bezier.x2 * (next.x - point.x)}
					{@const inY = point.y + bezier.y2 * (next.y - point.y)}
					<line x1={point.x} y1={point.y} x2={outX} y2={outY} stroke="oklch(0.75 0.02 55)" />
					<line x1={next.x} y1={next.y} x2={inX} y2={inY} stroke="oklch(0.75 0.02 55)" />
					<circle
						role="slider"
						tabindex="-1"
						aria-label={m.video_editor_keyframe_graph_outgoing_handle()}
						aria-valuemin="0"
						aria-valuemax="1"
						aria-valuenow={bezier.x1}
						cx={outX}
						cy={outY}
						r={HANDLE_HIT_RADIUS}
						fill="transparent"
						class="cursor-grab"
						onpointerdown={(event) =>
							startHandleDrag(point.keyframe, next.keyframe, 'out', bezier, event)}
					/>
					<circle
						cx={outX}
						cy={outY}
						r="4"
						fill="oklch(0.82 0.02 55)"
						class="pointer-events-none"
					/>
					<circle
						role="slider"
						tabindex="-1"
						aria-label={m.video_editor_keyframe_graph_incoming_handle()}
						aria-valuemin="0"
						aria-valuemax="1"
						aria-valuenow={bezier.x2}
						cx={inX}
						cy={inY}
						r={HANDLE_HIT_RADIUS}
						fill="transparent"
						class="cursor-grab"
						onpointerdown={(event) =>
							startHandleDrag(point.keyframe, next.keyframe, 'in', bezier, event)}
					/>
					<circle cx={inX} cy={inY} r="4" fill="oklch(0.82 0.02 55)" class="pointer-events-none" />
				{/if}
			{/each}

			{#each points as point (point.id)}
				<g
					role="button"
					tabindex="0"
					aria-label={m.video_editor_keyframe_graph_point({
						property: propertyLabel,
						frame: point.keyframe.frame
					})}
					onpointerdown={(event) => startKeyframeDrag(point, event)}
					onkeydown={(event) => onPointKeyDown(point, event)}
				>
					<circle
						cx={point.x}
						cy={point.y}
						r={KEYFRAME_HIT_RADIUS}
						fill="transparent"
						class="cursor-grab"
					/>
					{#if selectedIds.has(point.id)}
						<circle
							cx={point.x}
							cy={point.y}
							r="9"
							fill="none"
							stroke="oklch(0.76 0.14 45 / 0.5)"
							stroke-width="2"
						/>
					{/if}
					<path
						d={`M ${point.x} ${point.y - 5} L ${point.x + 5} ${point.y} L ${point.x} ${point.y + 5} L ${point.x - 5} ${point.y} Z`}
						fill={selectedIds.has(point.id) ? 'oklch(0.76 0.14 45)' : 'oklch(0.82 0.02 55)'}
						stroke="oklch(0.12 0.01 55)"
						stroke-width="1.5"
						class="pointer-events-none"
					/>
				</g>
			{/each}

			<line
				role="slider"
				tabindex="-1"
				aria-label={m.video_editor_keyframe_graph_playhead()}
				aria-valuemin="0"
				aria-valuemax={item.durationInFrames - 1}
				aria-valuenow={relativePlayhead}
				x1={playheadX}
				x2={playheadX}
				y1="0"
				y2={dimensions.top + dimensions.height}
				stroke="oklch(0.66 0.14 45)"
				stroke-width="1"
				class="cursor-ew-resize"
				onpointerdown={(event) => {
					event.stopPropagation();
					scrub(event);
				}}
			/>
			{#if marquee}
				<rect
					x={marquee.x}
					y={marquee.y}
					width={marquee.width}
					height={marquee.height}
					fill="oklch(0.66 0.14 45 / 0.12)"
					stroke="oklch(0.76 0.14 45)"
					stroke-dasharray="3 2"
					class="pointer-events-none"
				/>
			{/if}
		</svg>
	</div>
	{#if segmentMenu}
		{@const kf = keyframes.find((k) => k.frame === segmentMenu.leftFrame)}
		{#if kf}
			<div
				class="mx-2 mb-2 rounded-md border border-[oklch(0.28_0.015_55)] bg-[oklch(0.18_0.01_50)] p-2 shadow-lg"
				data-segment-menu
			>
				<div class="mb-2 flex flex-wrap items-center gap-1">
					<span class="mr-auto text-[10px] font-medium text-[oklch(0.72_0.02_55)]">
						{m.video_editor_keyframe_graph_segment()} · {kf.frame} → {segmentSpans.find(
							(s) => s.start.frame === kf.frame
						)?.end.frame ?? ''}
					</span>
					<Button
						variant="ghost"
						size="sm"
						class="h-6 min-h-6 px-2 text-[10px]"
						onclick={() => {
							segmentMenu = null;
							springGesture = null;
						}}>{m.video_editor_keyframe_graph_close()}</Button
					>
				</div>
				<div class="flex flex-wrap gap-1">
					{#each [{ value: 'linear', label: m.video_editor_keyframe_easing_linear() }, { value: 'ease-in', label: m.video_editor_keyframe_easing_in() }, { value: 'ease-out', label: m.video_editor_keyframe_easing_out() }, { value: 'ease-in-out', label: m.video_editor_keyframe_easing_in_out() }, { value: 'hold', label: m.video_editor_keyframe_easing_hold() }, { value: 'cubic-bezier', label: m.video_editor_keyframe_easing_bezier() }, { value: 'spring', label: m.video_editor_keyframe_easing_spring() }] as option}
						<button
							class="rounded px-2 py-1 text-[10px] font-medium {segmentMenu.easing === option.value
								? 'bg-[oklch(0.66_0.14_45)] text-white'
								: 'bg-[oklch(0.25_0.01_50)] text-[oklch(0.78_0.02_55)] hover:bg-[oklch(0.32_0.02_55)]'}"
							aria-pressed={segmentMenu.easing === option.value}
							onclick={() => handleSegmentEasingChange(kf.frame, option.value)}
						>
							{option.label}
						</button>
					{/each}
				</div>
				{#if segmentMenu.easing === 'cubic-bezier' || kf.easing === 'cubic-bezier'}
					<div class="mt-2 flex flex-wrap gap-1">
						{#each showAllEasing ? EASING_PRESETS : EASING_PRESETS.slice(0, 8) as preset}
							<button
								class="rounded border border-[oklch(0.28_0.015_55)] bg-[oklch(0.22_0.01_50)] px-1.5 py-1 text-[9px] text-[oklch(0.72_0.02_55)] hover:bg-[oklch(0.28_0.015_55)]"
								title={(preset as any).name ?? bezierPresetLocalizedLabel((preset as any).value)}
								onclick={() => {
									const key = (preset as any).name ?? (preset as any).value;
									const isEasingPreset =
										(preset as any).bezier !== undefined || (preset as any).points !== undefined;
									const bezier = (preset as any).bezier ?? (preset as any).points;
									if (bezier) {
										const cfg: EasingConfig = { type: 'cubic-bezier', bezier };
										const frames =
											selectedIds.size > 1
												? [...selectedIds]
														.map((id) => keyframes.find((k) => keyframeIdentity(k) === id)?.frame)
														.filter((f): f is number => f !== undefined)
												: [kf.frame];
										const uniq = [...new Set(frames)];
										const updates = uniq.map((f) => ({
											property,
											frame: f,
											easing: 'cubic-bezier' as EasingType,
											easingConfig: cfg
										}));
										const changed =
											uniq.length > 1
												? setKeyframeEasings(item.id, updates)
												: setKeyframeEasing(item.id, property, kf.frame, 'cubic-bezier', cfg);
										if (changed) onedit();
									} else {
										segmentBezierPreset(kf.frame, key);
									}
								}}
							>
								{(preset as any).name ?? bezierPresetLocalizedLabel((preset as any).value)}
							</button>
						{/each}
					</div>
				{/if}
				{#if segmentMenu.easing === 'spring' || kf.easing === 'spring'}
					{@const draft = springGesture?.draft ?? kf.easingConfig?.spring ?? DEFAULT_SPRING_PARAMS}
					<div class="mt-2 grid grid-cols-3 gap-2" data-spring-gesture>
						<label class="flex flex-col gap-1 text-[10px] text-[oklch(0.72_0.02_55)]">
							{m.video_editor_keyframe_graph_tension()}
							<input
								type="range"
								min="1"
								max="500"
								value={draft.tension}
								class="w-full"
								// SAFETY: range input target is an HTMLInputElement
								oninput={(e) =>
									segmentSpringDraftChange('tension', Number((e.target as HTMLInputElement).value))}
								onchange={() => commitSegmentSpring(kf.frame)}
								onpointercancel={() => cancelSegmentSpring(kf.frame)}
								onlostpointercapture={() => cancelSegmentSpring(kf.frame)}
								onkeydown={(e) => {
									if (e.key === 'Escape') {
										e.preventDefault();
										cancelSegmentSpring(kf.frame);
									}
									if (e.key === 'Enter') commitSegmentSpring(kf.frame);
								}}
							/>
							<span class="font-mono text-[9px]">{draft.tension}</span>
						</label>
						<label class="flex flex-col gap-1 text-[10px] text-[oklch(0.72_0.02_55)]">
							{m.video_editor_keyframe_graph_friction()}
							<input
								type="range"
								min="1"
								max="100"
								value={draft.friction}
								class="w-full"
								// SAFETY: range input target is an HTMLInputElement
								oninput={(e) =>
									segmentSpringDraftChange(
										'friction',
										Number((e.target as HTMLInputElement).value)
									)}
								onchange={() => commitSegmentSpring(kf.frame)}
								onpointercancel={() => cancelSegmentSpring(kf.frame)}
								onlostpointercapture={() => cancelSegmentSpring(kf.frame)}
								onkeydown={(e) => {
									if (e.key === 'Escape') {
										e.preventDefault();
										cancelSegmentSpring(kf.frame);
									}
									if (e.key === 'Enter') commitSegmentSpring(kf.frame);
								}}
							/>
							<span class="font-mono text-[9px]">{draft.friction}</span>
						</label>
						<label class="flex flex-col gap-1 text-[10px] text-[oklch(0.72_0.02_55)]">
							{m.video_editor_keyframe_graph_mass()}
							<input
								type="range"
								min="0.1"
								max="10"
								step="0.1"
								value={draft.mass}
								class="w-full"
								// SAFETY: range input target is an HTMLInputElement
								oninput={(e) =>
									segmentSpringDraftChange('mass', Number((e.target as HTMLInputElement).value))}
								onchange={() => commitSegmentSpring(kf.frame)}
								onpointercancel={() => cancelSegmentSpring(kf.frame)}
								onlostpointercapture={() => cancelSegmentSpring(kf.frame)}
								onkeydown={(e) => {
									if (e.key === 'Escape') {
										e.preventDefault();
										cancelSegmentSpring(kf.frame);
									}
									if (e.key === 'Enter') commitSegmentSpring(kf.frame);
								}}
							/>
							<span class="font-mono text-[9px]">{draft.mass}</span>
						</label>
					</div>
				{/if}
			</div>
		{/if}
	{/if}
	<p class="sr-only" aria-live="polite">
		{m.video_editor_keyframe_graph_instructions({ count: selectedIds.size })}
	</p>
</div>
