<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { m } from '$lib/paraglide/messages';
	import type { GpuEffect } from '$lib/video-editor/effects/types';
	import type { GpuParamValues } from '$lib/video-editor/effects/gpu/types';
	import {
		CURVE_CHANNELS,
		CURVE_MAX_POINTS,
		CURVE_POINT_MIN_GAP,
		curvePointsParamKey,
		evaluateMonotoneCurve,
		isIdentityCurve,
		readCurveChannelPoints,
		resetCurveChannelParams,
		sanitizeCurveChannelPoints,
		serializeCurveChannelPoints,
		type CurveChannel,
		type CurvePoint
	} from '$lib/video-editor/effects/gpu/curves';

	let {
		gpuEffect,
		ondraft,
		oncommit
	}: {
		gpuEffect: GpuEffect;
		ondraft: (params: GpuParamValues | null) => void;
		oncommit: (params: GpuParamValues) => void;
	} = $props();

	type ChannelDraft = Record<CurveChannel, CurvePoint[]>;
	interface DragState {
		channel: CurveChannel;
		index: number;
		pointerId: number;
		original: CurvePoint[];
	}

	const SIZE = 256;
	const SAMPLE_STEPS = 96;
	const channelColors = {
		master: '#e8e4dc',
		red: '#f87171',
		green: '#4ade80',
		blue: '#60a5fa'
	} satisfies Record<CurveChannel, string>;

	let svg = $state<SVGSVGElement>();
	let activeChannel = $state<CurveChannel>('master');
	let selectedPointIndex = $state<number | null>(null);
	let draft = $state<ChannelDraft>(readAllChannels({}));
	let drag = $state<DragState | null>(null);
	let keyboardDraft = $state<{
		channel: CurveChannel;
		index: number;
		commit: (params: GpuParamValues) => void;
		clearDraft: (params: GpuParamValues | null) => void;
	} | null>(null);
	let boundEffectId = $state('');
	let pendingPosition: CurvePoint | null = null;
	let dragFrame: number | null = null;
	let keyboardCommitTimer: ReturnType<typeof setTimeout> | null = null;

	const activePoints = $derived(draft[activeChannel]);
	const activeColor = $derived(channelColors[activeChannel]);
	const channelLabels = $derived<Record<CurveChannel, string>>({
		master: m.video_editor_curves_master(),
		red: m.video_editor_curves_red(),
		green: m.video_editor_curves_green(),
		blue: m.video_editor_curves_blue()
	});

	$effect(() => {
		if (!drag && !keyboardDraft) draft = readAllChannels(gpuEffect.params);
	});

	$effect(() => {
		const nextEffectId = gpuEffect.id;
		if (!boundEffectId) {
			boundEffectId = nextEffectId;
			return;
		}
		if (nextEffectId === boundEffectId) return;
		untrack(() => {
			commitKeyboardDraft();
			if (dragFrame !== null) cancelAnimationFrame(dragFrame);
			dragFrame = null;
			pendingPosition = null;
			drag = null;
			selectedPointIndex = null;
			boundEffectId = nextEffectId;
			draft = readAllChannels(gpuEffect.params);
			ondraft(null);
		});
	});

	function readAllChannels(params: GpuParamValues) {
		return {
			master: readCurveChannelPoints(params, 'master'),
			red: readCurveChannelPoints(params, 'red'),
			green: readCurveChannelPoints(params, 'green'),
			blue: readCurveChannelPoints(params, 'blue')
		} satisfies ChannelDraft;
	}

	function curvePath(points: readonly CurvePoint[]): string {
		const segments: string[] = [];
		for (let index = 0; index <= SAMPLE_STEPS; index++) {
			const x = index / SAMPLE_STEPS;
			const y = evaluateMonotoneCurve(points, x);
			segments.push(
				`${index === 0 ? 'M' : 'L'} ${(x * SIZE).toFixed(2)} ${((1 - y) * SIZE).toFixed(2)}`
			);
		}
		return segments.join(' ');
	}

	function normalizedPosition(clientX: number, clientY: number): CurvePoint | null {
		const rect = svg?.getBoundingClientRect();
		if (!rect || rect.width <= 0 || rect.height <= 0) return null;
		return {
			x: clamp((clientX - rect.left) / rect.width),
			y: clamp(1 - (clientY - rect.top) / rect.height)
		};
	}

	function movedPoints(
		points: readonly CurvePoint[],
		index: number,
		position: CurvePoint
	): CurvePoint[] | null {
		const current = points[index];
		if (!current) return null;
		const lastIndex = points.length - 1;
		let x = position.x;
		if (index === 0) x = 0;
		else if (index === lastIndex) x = 1;
		else {
			const previous = points[index - 1];
			const next = points[index + 1];
			if (!previous || !next) return null;
			x = Math.max(previous.x + CURVE_POINT_MIN_GAP, Math.min(next.x - CURVE_POINT_MIN_GAP, x));
		}
		return points.map((point, pointIndex) =>
			pointIndex === index ? { x, y: clamp(position.y) } : point
		);
	}

	function setChannelDraft(channel: CurveChannel, points: readonly CurvePoint[]): void {
		const next = sanitizeCurveChannelPoints(points);
		draft = { ...draft, [channel]: next };
		ondraft({ [curvePointsParamKey(channel)]: serializeCurveChannelPoints(next) });
	}

	function commitChannel(channel: CurveChannel, points: readonly CurvePoint[]): void {
		const next = sanitizeCurveChannelPoints(points);
		draft = { ...draft, [channel]: next };
		oncommit({ [curvePointsParamKey(channel)]: serializeCurveChannelPoints(next) });
		ondraft(null);
	}

	function insertIndex(points: readonly CurvePoint[], position: CurvePoint): number | null {
		if (points.length >= CURVE_MAX_POINTS) return null;
		const nextIndex = points.findIndex((point) => position.x < point.x);
		const index = nextIndex < 0 ? points.length - 1 : nextIndex;
		const previous = points[index - 1];
		const next = points[index];
		if (
			!previous ||
			!next ||
			position.x - previous.x < CURVE_POINT_MIN_GAP ||
			next.x - position.x < CURVE_POINT_MIN_GAP
		) {
			return null;
		}
		return index;
	}

	function beginNewPoint(event: PointerEvent): void {
		if (!gpuEffect.enabled || event.button !== 0 || drag) return;
		const position = normalizedPosition(event.clientX, event.clientY);
		if (!position) return;
		const points = draft[activeChannel];
		const index = insertIndex(points, position);
		if (index === null) return;
		event.preventDefault();
		const next = [...points.slice(0, index), position, ...points.slice(index)];
		setChannelDraft(activeChannel, next);
		selectedPointIndex = index;
		drag = { channel: activeChannel, index, pointerId: event.pointerId, original: points };
		try {
			svg?.setPointerCapture(event.pointerId);
		} catch {
			// Synthetic test events and interrupted pointers may not own capture.
		}
	}

	function beginPointDrag(event: PointerEvent, index: number): void {
		if (!gpuEffect.enabled || event.button !== 0 || drag) return;
		event.preventDefault();
		event.stopPropagation();
		const points = draft[activeChannel];
		selectedPointIndex = index;
		const interior = index > 0 && index < points.length - 1;
		if (event.detail >= 2 && interior) {
			commitChannel(
				activeChannel,
				points.filter((_, pointIndex) => pointIndex !== index)
			);
			selectedPointIndex = null;
			return;
		}
		drag = { channel: activeChannel, index, pointerId: event.pointerId, original: points };
		try {
			svg?.setPointerCapture(event.pointerId);
		} catch {
			// Synthetic test events and interrupted pointers may not own capture.
		}
	}

	function flushDrag(): void {
		dragFrame = null;
		if (!drag || !pendingPosition) return;
		const next = movedPoints(draft[drag.channel], drag.index, pendingPosition);
		if (next) setChannelDraft(drag.channel, next);
	}

	function handlePointerMove(event: PointerEvent): void {
		if (!drag || drag.pointerId !== event.pointerId) return;
		pendingPosition = normalizedPosition(event.clientX, event.clientY);
		if (pendingPosition && dragFrame === null) dragFrame = requestAnimationFrame(flushDrag);
	}

	function finishPointer(event: PointerEvent): void {
		const state = drag;
		if (!state || state.pointerId !== event.pointerId) return;
		if (dragFrame !== null) cancelAnimationFrame(dragFrame);
		dragFrame = null;
		const position = normalizedPosition(event.clientX, event.clientY) ?? pendingPosition;
		const next = position ? movedPoints(draft[state.channel], state.index, position) : null;
		commitChannel(state.channel, next ?? draft[state.channel]);
		pendingPosition = null;
		drag = null;
		if (svg?.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
	}

	function cancelPointer(event: PointerEvent): void {
		const state = drag;
		if (!state || state.pointerId !== event.pointerId) return;
		if (dragFrame !== null) cancelAnimationFrame(dragFrame);
		dragFrame = null;
		pendingPosition = null;
		draft = { ...draft, [state.channel]: state.original };
		drag = null;
		ondraft(null);
	}

	function movePointByKeyboard(event: KeyboardEvent, index: number): void {
		if (!gpuEffect.enabled) return;
		const points = draft[activeChannel];
		const point = points[index];
		if (!point) return;
		if (
			(event.key === 'Delete' || event.key === 'Backspace') &&
			index > 0 &&
			index < points.length - 1
		) {
			event.preventDefault();
			cancelKeyboardCommit();
			commitChannel(
				activeChannel,
				points.filter((_, pointIndex) => pointIndex !== index)
			);
			selectedPointIndex = null;
			return;
		}
		if (event.key === 'Escape' && keyboardDraft) {
			event.preventDefault();
			cancelKeyboardCommit();
			draft = readAllChannels(gpuEffect.params);
			ondraft(null);
			return;
		}
		const step = event.altKey ? 0.001 : event.shiftKey ? 0.05 : 0.01;
		const delta =
			event.key === 'ArrowLeft'
				? { x: -step, y: 0 }
				: event.key === 'ArrowRight'
					? { x: step, y: 0 }
					: event.key === 'ArrowDown'
						? { x: 0, y: -step }
						: event.key === 'ArrowUp'
							? { x: 0, y: step }
							: null;
		if (!delta) return;
		event.preventDefault();
		const next = movedPoints(points, index, { x: point.x + delta.x, y: point.y + delta.y });
		if (!next) return;
		keyboardDraft ??= { channel: activeChannel, index, commit: oncommit, clearDraft: ondraft };
		setChannelDraft(activeChannel, next);
		if (keyboardCommitTimer) clearTimeout(keyboardCommitTimer);
		keyboardCommitTimer = setTimeout(commitKeyboardDraft, 250);
	}

	function commitKeyboardDraft(): void {
		const pending = keyboardDraft;
		if (!pending) return;
		const channel = pending.channel;
		keyboardDraft = null;
		if (keyboardCommitTimer) clearTimeout(keyboardCommitTimer);
		keyboardCommitTimer = null;
		const next = sanitizeCurveChannelPoints(draft[channel]);
		draft = { ...draft, [channel]: next };
		pending.commit({ [curvePointsParamKey(channel)]: serializeCurveChannelPoints(next) });
		pending.clearDraft(null);
	}

	function cancelKeyboardCommit(): void {
		if (keyboardCommitTimer) clearTimeout(keyboardCommitTimer);
		keyboardCommitTimer = null;
		keyboardDraft = null;
	}

	function resetActiveChannel(): void {
		cancelKeyboardCommit();
		selectedPointIndex = null;
		oncommit(resetCurveChannelParams(activeChannel));
		ondraft(null);
		draft = readAllChannels({ ...gpuEffect.params, ...resetCurveChannelParams(activeChannel) });
	}

	function selectChannel(channel: CurveChannel): void {
		commitKeyboardDraft();
		selectedPointIndex = null;
		activeChannel = channel;
	}

	function removeSelectedPoint(): void {
		const index = selectedPointIndex;
		if (index === null || index <= 0 || index >= activePoints.length - 1) return;
		commitChannel(
			activeChannel,
			activePoints.filter((_, pointIndex) => pointIndex !== index)
		);
		selectedPointIndex = null;
	}

	function clamp(value: number): number {
		return Math.max(0, Math.min(1, value));
	}

	onDestroy(() => {
		if (dragFrame !== null) cancelAnimationFrame(dragFrame);
		commitKeyboardDraft();
		ondraft(null);
	});
</script>

<div class="mt-2 rounded-lg border border-[oklch(0.31_0.018_55)] bg-[oklch(0.15_0.008_55)] p-2">
	<div class="mb-2 flex flex-wrap items-center gap-1">
		<span class="mr-auto text-[10px] font-medium text-[oklch(0.65_0.015_55)] uppercase">
			{m.video_editor_curves_channel()}
		</span>
		{#each CURVE_CHANNELS as channel (channel)}
			<button
				type="button"
				class={`min-h-11 min-w-11 rounded px-2 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.72_0.14_45)] ${activeChannel === channel ? 'bg-[oklch(0.3_0.025_55)] text-white' : 'text-[oklch(0.68_0.015_55)] hover:bg-[oklch(0.23_0.012_55)]'}`}
				disabled={!gpuEffect.enabled || drag !== null}
				aria-pressed={activeChannel === channel}
				style:color={activeChannel === channel ? channelColors[channel] : undefined}
				onclick={() => selectChannel(channel)}
			>
				{channelLabels[channel]}
			</button>
		{/each}
		<button
			type="button"
			class="flex size-11 items-center justify-center rounded text-[oklch(0.68_0.015_55)] hover:bg-[oklch(0.23_0.012_55)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.72_0.14_45)] disabled:opacity-35"
			disabled={!gpuEffect.enabled ||
				drag !== null ||
				selectedPointIndex === null ||
				selectedPointIndex === 0 ||
				selectedPointIndex === activePoints.length - 1}
			aria-label={m.video_editor_curves_remove_point()}
			title={m.video_editor_curves_remove_point()}
			onclick={removeSelectedPoint}
		>
			<Trash2Icon class="size-4" aria-hidden="true" />
		</button>
		<button
			type="button"
			class="flex size-11 items-center justify-center rounded text-[oklch(0.68_0.015_55)] hover:bg-[oklch(0.23_0.012_55)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.72_0.14_45)] disabled:opacity-35"
			disabled={!gpuEffect.enabled || drag !== null || isIdentityCurve(activePoints)}
			aria-label={m.video_editor_curves_reset_channel({ channel: channelLabels[activeChannel] })}
			title={m.video_editor_curves_reset_channel({ channel: channelLabels[activeChannel] })}
			onclick={resetActiveChannel}
		>
			<RotateCcwIcon class="size-4" aria-hidden="true" />
		</button>
	</div>

	<div
		class="relative aspect-square w-full overflow-hidden rounded-md border border-white/10 bg-black/55"
	>
		<svg
			bind:this={svg}
			viewBox={`0 0 ${SIZE} ${SIZE}`}
			class={gpuEffect.enabled
				? 'size-full touch-none select-none'
				: 'pointer-events-none size-full opacity-55'}
			role="group"
			aria-label={m.video_editor_curves_editor({ channel: channelLabels[activeChannel] })}
			data-curves-editor
			onpointerdown={beginNewPoint}
			onpointermove={handlePointerMove}
			onpointerup={finishPointer}
			onpointercancel={cancelPointer}
			onlostpointercapture={cancelPointer}
		>
			<rect width={SIZE} height={SIZE} fill="transparent" class="cursor-crosshair" />
			{#each [0.25, 0.5, 0.75] as position (position)}
				<line
					x1={position * SIZE}
					y1="0"
					x2={position * SIZE}
					y2={SIZE}
					stroke="rgba(148,163,184,0.2)"
				/>
				<line
					x1="0"
					y1={position * SIZE}
					x2={SIZE}
					y2={position * SIZE}
					stroke="rgba(148,163,184,0.2)"
				/>
			{/each}
			<path
				d={`M 0 ${SIZE} L ${SIZE} 0`}
				stroke="rgba(148,163,184,0.35)"
				stroke-dasharray="4 4"
				fill="none"
			/>
			{#if activeChannel === 'master'}
				{#each CURVE_CHANNELS.slice(1) as channel (channel)}
					<path
						d={curvePath(draft[channel])}
						stroke={channelColors[channel]}
						stroke-width="1.25"
						opacity="0.3"
						fill="none"
					/>
				{/each}
			{:else}
				<path
					d={curvePath(draft.master)}
					stroke={channelColors.master}
					stroke-width="1.25"
					stroke-dasharray="5 4"
					opacity="0.35"
					fill="none"
				/>
			{/if}
			<path d={curvePath(activePoints)} stroke={activeColor} stroke-width="2" fill="none" />
			{#each activePoints as point, index (`${activeChannel}-${index}`)}
				<line
					x1={point.x * SIZE}
					y1={SIZE}
					x2={point.x * SIZE}
					y2={(1 - point.y) * SIZE}
					stroke={activeColor}
					opacity="0.18"
				/>
				<rect
					x={Math.max(0, Math.min(SIZE - 44, point.x * SIZE - 22))}
					y={Math.max(0, Math.min(SIZE - 44, (1 - point.y) * SIZE - 22))}
					width="44"
					height="44"
					rx="22"
					fill="transparent"
					stroke={selectedPointIndex === index ? '#ffffff' : 'transparent'}
					stroke-width="2"
					class="cursor-move focus:outline-none focus-visible:stroke-[oklch(0.85_0.14_85)] focus-visible:stroke-[4px]"
					data-curve-point={index}
					tabindex={gpuEffect.enabled ? 0 : -1}
					role="slider"
					aria-label={m.video_editor_curves_point({
						channel: channelLabels[activeChannel],
						index: index + 1
					})}
					aria-valuemin="0"
					aria-valuemax="100"
					aria-valuenow={Math.round(point.y * 100)}
					aria-valuetext={m.video_editor_curves_point_value({
						input: Math.round(point.x * 100),
						output: Math.round(point.y * 100)
					})}
					onpointerdown={(event) => beginPointDrag(event, index)}
					onkeydown={(event) => movePointByKeyboard(event, index)}
					onfocus={() => (selectedPointIndex = index)}
					onblur={commitKeyboardDraft}
				></rect>
				<circle
					cx={point.x * SIZE}
					cy={(1 - point.y) * SIZE}
					r="7"
					fill={activeColor}
					stroke="rgba(3,7,18,0.95)"
					stroke-width="2"
					pointer-events="none"
				></circle>
			{/each}
		</svg>
	</div>
	<p class="mt-1.5 text-[10px] leading-4 text-[oklch(0.62_0.015_55)]">
		{m.video_editor_curves_hint()}
	</p>
</div>
