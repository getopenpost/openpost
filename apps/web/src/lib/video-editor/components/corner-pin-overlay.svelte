<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import type { TimelineItem, TimelineItemCornerPin } from '$lib/video-editor/project/types';
	import {
		cornerPinPoints,
		resolveCornerPinForSize,
		withCornerPinReferenceSize,
		type CornerPinKey,
		type CornerPinOffsets
	} from '$lib/video-editor/preview/corner-pin';

	let {
		item,
		canvasWidth,
		canvasHeight,
		boxStyle,
		screenScale,
		onpreview,
		oncommit
	}: {
		item: TimelineItem;
		canvasWidth: number;
		canvasHeight: number;
		boxStyle: string;
		screenScale: number;
		onpreview: (pin: TimelineItemCornerPin | null) => void;
		oncommit: (pin: TimelineItemCornerPin) => void;
	} = $props();

	let svg = $state<SVGSVGElement | null>(null);
	let draft = $state<TimelineItemCornerPin | null>(null);
	const width = $derived(Math.max(1, item.transform?.width ?? canvasWidth));
	const height = $derived(Math.max(1, item.transform?.height ?? canvasHeight));
	const zero: CornerPinOffsets = {
		topLeft: [0, 0],
		topRight: [0, 0],
		bottomRight: [0, 0],
		bottomLeft: [0, 0]
	};
	const pin = $derived(resolveCornerPinForSize(draft ?? item.cornerPin, width, height) ?? zero);
	const points = $derived(cornerPinPoints(width, height, pin));
	const keys: CornerPinKey[] = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];

	function localPoint(event: PointerEvent): [number, number] {
		const matrix = svg?.getScreenCTM();
		if (!matrix) return [0, 0];
		const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
		return [point.x, point.y];
	}

	function offsetFor(corner: CornerPinKey, point: [number, number]): [number, number] {
		switch (corner) {
			case 'topLeft':
				return point;
			case 'topRight':
				return [point[0] - width, point[1]];
			case 'bottomRight':
				return [point[0] - width, point[1] - height];
			case 'bottomLeft':
				return [point[0], point[1] - height];
		}
	}

	function startDrag(event: PointerEvent, corner: CornerPinKey): void {
		event.preventDefault();
		event.stopPropagation();
		const pointerId = event.pointerId;
		let nextPin = withCornerPinReferenceSize(pin, width, height);
		const move = (next: PointerEvent) => {
			if (next.pointerId !== pointerId) return;
			nextPin = withCornerPinReferenceSize(
				{ ...pin, [corner]: offsetFor(corner, localPoint(next)) },
				width,
				height
			);
			draft = nextPin;
			onpreview(nextPin);
		};
		const cleanup = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', finish);
			window.removeEventListener('pointercancel', cancel);
		};
		const finish = (next: PointerEvent) => {
			if (next.pointerId !== pointerId) return;
			move(next);
			cleanup();
			oncommit(nextPin);
			draft = null;
			onpreview(null);
		};
		const cancel = (next: PointerEvent) => {
			if (next.pointerId !== pointerId) return;
			cleanup();
			draft = null;
			onpreview(null);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', finish);
		window.addEventListener('pointercancel', cancel);
	}

	function moveWithKeyboard(event: KeyboardEvent, corner: CornerPinKey): void {
		const x = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
		const y = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
		if (x === 0 && y === 0) return;
		event.preventDefault();
		const step = event.shiftKey ? 10 : 1;
		const current = pin[corner];
		oncommit(
			withCornerPinReferenceSize(
				{ ...pin, [corner]: [current[0] + x * step, current[1] + y * step] },
				width,
				height
			)
		);
	}
</script>

<div
	class="pointer-events-auto absolute border border-[oklch(0.76_0.13_220)] shadow-[0_0_0_1px_black]"
	style={boxStyle}
	data-corner-pin-editor
>
	<svg
		bind:this={svg}
		class="absolute inset-0 size-full overflow-visible"
		viewBox={`0 0 ${width} ${height}`}
		aria-label={m.video_editor_corner_pin_hint()}
	>
		<polygon
			points={keys.map((key) => points[key].join(',')).join(' ')}
			fill="oklch(0.7 0.12 220 / 0.08)"
			stroke="oklch(0.8 0.14 220)"
			stroke-width="2"
			vector-effect="non-scaling-stroke"
			pointer-events="none"
		></polygon>
		{#each keys as key}
			<circle
				cx={points[key][0]}
				cy={points[key][1]}
				r={10 / screenScale}
				fill="oklch(0.8 0.14 220)"
				stroke="black"
				stroke-width="2"
				vector-effect="non-scaling-stroke"
				class="cursor-move focus:outline-none focus-visible:stroke-white"
				role="button"
				tabindex="0"
				aria-label={m.video_editor_corner_pin_handle({ corner: key })}
				onpointerdown={(event) => startDrag(event, key)}
				onkeydown={(event) => moveWithKeyboard(event, key)}
			></circle>
		{/each}
	</svg>
</div>
