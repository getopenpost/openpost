<script lang="ts">
	/* oxlint-disable anti-slop/no-known-value-widening, anti-slop/require-safety-comment-for-type-assertion -- Typed EQ field descriptors build narrow patches from pointer and keyboard gestures. */
	import { m } from '$lib/paraglide/messages';
	import {
		AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ,
		AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ,
		AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ,
		AUDIO_EQ_HIGH_FREQUENCY_HZ,
		AUDIO_EQ_HIGH_MAX_FREQUENCY_HZ,
		AUDIO_EQ_HIGH_MIN_FREQUENCY_HZ,
		AUDIO_EQ_HIGH_MID_FREQUENCY_HZ,
		AUDIO_EQ_HIGH_MID_MAX_FREQUENCY_HZ,
		AUDIO_EQ_HIGH_MID_MIN_FREQUENCY_HZ,
		AUDIO_EQ_LOW_CUT_FREQUENCY_HZ,
		AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ,
		AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ,
		AUDIO_EQ_LOW_FREQUENCY_HZ,
		AUDIO_EQ_LOW_MAX_FREQUENCY_HZ,
		AUDIO_EQ_LOW_MIN_FREQUENCY_HZ,
		AUDIO_EQ_LOW_MID_FREQUENCY_HZ,
		AUDIO_EQ_LOW_MID_MAX_FREQUENCY_HZ,
		AUDIO_EQ_LOW_MID_MIN_FREQUENCY_HZ,
		clampAudioEqFrequencyHz,
		clampAudioEqGainDb,
		resolveAudioEqSettings,
		sampleAudioEqResponseCurve
	} from '$lib/video-editor/audio/audio-eq';
	import type { AudioEqSettings, ResolvedAudioEqSettings } from '$lib/video-editor/audio/types';

	let {
		settings,
		disabled = false,
		onbegin = () => {},
		onlive,
		oncommit,
		oncancel = () => {}
	}: {
		settings: ResolvedAudioEqSettings;
		disabled?: boolean;
		onbegin?: () => void;
		onlive: (patch: Partial<AudioEqSettings>) => void;
		oncommit: (patch: Partial<AudioEqSettings>) => void;
		oncancel?: () => void;
	} = $props();

	type HandleId = 'band1' | 'low' | 'lowMid' | 'highMid' | 'high' | 'band6';
	type FrequencyField =
		| 'band1FrequencyHz'
		| 'lowFrequencyHz'
		| 'lowMidFrequencyHz'
		| 'highMidFrequencyHz'
		| 'highFrequencyHz'
		| 'band6FrequencyHz';
	type GainField =
		| 'band1GainDb'
		| 'lowGainDb'
		| 'lowMidGainDb'
		| 'highMidGainDb'
		| 'highGainDb'
		| 'band6GainDb';
	type EnabledField =
		| 'band1Enabled'
		| 'lowEnabled'
		| 'lowMidEnabled'
		| 'highMidEnabled'
		| 'highEnabled'
		| 'band6Enabled';

	interface HandleDefinition {
		id: HandleId;
		number: 1 | 2 | 3 | 4 | 5 | 6;
		label: string;
		kind: 'gain' | 'cut' | 'notch';
		frequencyField: FrequencyField;
		gainField?: GainField;
		enabledField: EnabledField;
		minFrequencyHz: number;
		maxFrequencyHz: number;
		defaultFrequencyHz: number;
	}

	const WIDTH = 320;
	const HEIGHT = 240;
	const PADDING_X = 2;
	const PADDING_TOP = 2;
	const PADDING_BOTTOM = 24;
	const MIN_FREQUENCY_HZ = 20;
	const MAX_FREQUENCY_HZ = 19000;
	const DISPLAY_DB_MAX = 0;
	const DISPLAY_DB_MIN = -80;
	const EQ_BASELINE_DB = -40;
	const GRID_LEVELS_DB = [0, -10, -20, -30, -40, -50, -60, -70, -80] as const;
	const GRID_FREQUENCIES_HZ = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
	const KEYBOARD_GAIN_STEP_DB = 0.5;
	const KEYBOARD_FREQUENCY_RATIO = 1.06;
	const KEYBOARD_FREQUENCY_RATIO_FAST = 1.16;

	let root: HTMLDivElement;
	let drag = $state<{ handleId: HandleId; pointerId: number } | null>(null);
	let draft = $state<Partial<AudioEqSettings> | null>(null);
	const displayed = $derived(resolveAudioEqSettings({ ...settings, ...draft }));
	const response = $derived(
		sampleAudioEqResponseCurve(displayed, {
			sampleCount: 96,
			minFrequencyHz: MIN_FREQUENCY_HZ,
			maxFrequencyHz: MAX_FREQUENCY_HZ
		})
	);
	const responsePath = $derived(
		response
			.map(
				(point, index) =>
					`${index === 0 ? 'M' : 'L'} ${frequencyToX(point.frequencyHz)} ${gainToY(point.gainDb)}`
			)
			.join(' ')
	);
	const handles = $derived(getHandles(displayed));

	function getHandles(value: ResolvedAudioEqSettings): HandleDefinition[] {
		return [
			{
				id: 'band1',
				number: 1,
				label: m.video_editor_audio_eq_band_1(),
				kind: value.band1Type === 'high-pass' ? 'cut' : 'gain',
				frequencyField: 'band1FrequencyHz',
				gainField: 'band1GainDb',
				enabledField: 'band1Enabled',
				minFrequencyHz: AUDIO_EQ_LOW_CUT_MIN_FREQUENCY_HZ,
				maxFrequencyHz: AUDIO_EQ_LOW_CUT_MAX_FREQUENCY_HZ,
				defaultFrequencyHz: AUDIO_EQ_LOW_CUT_FREQUENCY_HZ
			},
			{
				id: 'low',
				number: 2,
				label: m.video_editor_audio_eq_low(),
				kind: value.lowType === 'notch' ? 'notch' : 'gain',
				frequencyField: 'lowFrequencyHz',
				gainField: 'lowGainDb',
				enabledField: 'lowEnabled',
				minFrequencyHz: AUDIO_EQ_LOW_MIN_FREQUENCY_HZ,
				maxFrequencyHz: AUDIO_EQ_LOW_MAX_FREQUENCY_HZ,
				defaultFrequencyHz: AUDIO_EQ_LOW_FREQUENCY_HZ
			},
			{
				id: 'lowMid',
				number: 3,
				label: m.video_editor_audio_eq_low_mid(),
				kind: value.lowMidType === 'notch' ? 'notch' : 'gain',
				frequencyField: 'lowMidFrequencyHz',
				gainField: 'lowMidGainDb',
				enabledField: 'lowMidEnabled',
				minFrequencyHz: AUDIO_EQ_LOW_MID_MIN_FREQUENCY_HZ,
				maxFrequencyHz: AUDIO_EQ_LOW_MID_MAX_FREQUENCY_HZ,
				defaultFrequencyHz: AUDIO_EQ_LOW_MID_FREQUENCY_HZ
			},
			{
				id: 'highMid',
				number: 4,
				label: m.video_editor_audio_eq_high_mid(),
				kind: value.highMidType === 'notch' ? 'notch' : 'gain',
				frequencyField: 'highMidFrequencyHz',
				gainField: 'highMidGainDb',
				enabledField: 'highMidEnabled',
				minFrequencyHz: AUDIO_EQ_HIGH_MID_MIN_FREQUENCY_HZ,
				maxFrequencyHz: AUDIO_EQ_HIGH_MID_MAX_FREQUENCY_HZ,
				defaultFrequencyHz: AUDIO_EQ_HIGH_MID_FREQUENCY_HZ
			},
			{
				id: 'high',
				number: 5,
				label: m.video_editor_audio_eq_high(),
				kind: value.highType === 'notch' ? 'notch' : 'gain',
				frequencyField: 'highFrequencyHz',
				gainField: 'highGainDb',
				enabledField: 'highEnabled',
				minFrequencyHz: AUDIO_EQ_HIGH_MIN_FREQUENCY_HZ,
				maxFrequencyHz: AUDIO_EQ_HIGH_MAX_FREQUENCY_HZ,
				defaultFrequencyHz: AUDIO_EQ_HIGH_FREQUENCY_HZ
			},
			{
				id: 'band6',
				number: 6,
				label: m.video_editor_audio_eq_band_6(),
				kind: value.band6Type === 'low-pass' ? 'cut' : 'gain',
				frequencyField: 'band6FrequencyHz',
				gainField: 'band6GainDb',
				enabledField: 'band6Enabled',
				minFrequencyHz: AUDIO_EQ_HIGH_CUT_MIN_FREQUENCY_HZ,
				maxFrequencyHz: AUDIO_EQ_HIGH_CUT_MAX_FREQUENCY_HZ,
				defaultFrequencyHz: AUDIO_EQ_HIGH_CUT_FREQUENCY_HZ
			}
		];
	}

	function frequencyToX(frequencyHz: number): number {
		const clamped = Math.max(MIN_FREQUENCY_HZ, Math.min(MAX_FREQUENCY_HZ, frequencyHz));
		const normalized =
			(Math.log(clamped) - Math.log(MIN_FREQUENCY_HZ)) /
			(Math.log(MAX_FREQUENCY_HZ) - Math.log(MIN_FREQUENCY_HZ));
		return PADDING_X + normalized * (WIDTH - PADDING_X * 2);
	}

	function xToFrequency(x: number): number {
		const clamped = Math.max(PADDING_X, Math.min(WIDTH - PADDING_X, x));
		const normalized = (clamped - PADDING_X) / (WIDTH - PADDING_X * 2);
		return MIN_FREQUENCY_HZ * Math.pow(MAX_FREQUENCY_HZ / MIN_FREQUENCY_HZ, normalized);
	}

	function displayDbToY(db: number): number {
		const clamped = Math.max(DISPLAY_DB_MIN, Math.min(DISPLAY_DB_MAX, db));
		const normalized = (DISPLAY_DB_MAX - clamped) / (DISPLAY_DB_MAX - DISPLAY_DB_MIN);
		return PADDING_TOP + normalized * (HEIGHT - PADDING_TOP - PADDING_BOTTOM);
	}

	function gainToY(gainDb: number): number {
		return displayDbToY(EQ_BASELINE_DB + clampAudioEqGainDb(gainDb));
	}

	function yToGain(y: number): number {
		const plotHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
		const clamped = Math.max(PADDING_TOP, Math.min(HEIGHT - PADDING_BOTTOM, y));
		const normalized = (clamped - PADDING_TOP) / plotHeight;
		const displayDb = DISPLAY_DB_MAX - normalized * (DISPLAY_DB_MAX - DISPLAY_DB_MIN);
		return Math.round(clampAudioEqGainDb(displayDb - EQ_BASELINE_DB) * 10) / 10;
	}

	function formatFrequency(frequencyHz: number): string {
		if (frequencyHz >= 1000) {
			const khz = frequencyHz / 1000;
			return `${Number.isInteger(khz) ? khz.toFixed(0) : khz.toFixed(1)}k`;
		}
		return `${Math.round(frequencyHz)}`;
	}

	function frequency(handle: HandleDefinition): number {
		return Number(displayed[handle.frequencyField]);
	}

	function gain(handle: HandleDefinition): number {
		return handle.gainField ? Number(displayed[handle.gainField]) : 0;
	}

	function enabled(handle: HandleDefinition): boolean {
		return Boolean(displayed[handle.enabledField]);
	}

	function localPointer(clientX: number, clientY: number): { x: number; y: number } | null {
		const rect = root.getBoundingClientRect();
		if (!rect.width || !rect.height) return null;
		return {
			x: ((clientX - rect.left) / rect.width) * WIDTH,
			y: ((clientY - rect.top) / rect.height) * HEIGHT
		};
	}

	function patchForPointer(
		handle: HandleDefinition,
		clientX: number,
		clientY: number
	): Partial<AudioEqSettings> | null {
		const point = localPointer(clientX, clientY);
		if (!point) return null;
		const nextFrequency = Math.round(
			clampAudioEqFrequencyHz(
				xToFrequency(point.x),
				handle.minFrequencyHz,
				handle.maxFrequencyHz,
				handle.defaultFrequencyHz
			)
		);
		const patch: Partial<AudioEqSettings> = { [handle.frequencyField]: nextFrequency };
		if (handle.kind === 'gain' && handle.gainField) patch[handle.gainField] = yToGain(point.y);
		return patch;
	}

	function resetPatch(handle: HandleDefinition): Partial<AudioEqSettings> {
		const patch: Partial<AudioEqSettings> = {
			[handle.enabledField]: false,
			[handle.frequencyField]: handle.defaultFrequencyHz
		};
		if (handle.gainField) patch[handle.gainField] = 0;
		return patch;
	}

	function startDrag(handle: HandleDefinition, event: PointerEvent): void {
		if (disabled || event.button !== 0) return;
		const patch = patchForPointer(handle, event.clientX, event.clientY);
		if (!patch) return;
		event.preventDefault();
		root.setPointerCapture?.(event.pointerId);
		drag = { handleId: handle.id, pointerId: event.pointerId };
		draft = patch;
		onbegin();
		onlive(patch);
	}

	function moveDrag(event: PointerEvent): void {
		if (!drag || drag.pointerId !== event.pointerId) return;
		const handle = handles.find((candidate) => candidate.id === drag?.handleId);
		if (!handle) return;
		const patch = patchForPointer(handle, event.clientX, event.clientY);
		if (!patch) return;
		draft = patch;
		onlive(patch);
	}

	function finishDrag(event: PointerEvent): void {
		if (!drag || drag.pointerId !== event.pointerId) return;
		root.releasePointerCapture?.(event.pointerId);
		const patch = draft ?? {};
		drag = null;
		draft = null;
		oncommit(patch);
	}

	function cancelDrag(event: PointerEvent): void {
		if (!drag || drag.pointerId !== event.pointerId) return;
		root.releasePointerCapture?.(event.pointerId);
		drag = null;
		draft = null;
		oncancel();
	}

	function nudgeFrequency(handle: HandleDefinition, direction: -1 | 1, fast: boolean): number {
		const ratio = fast ? KEYBOARD_FREQUENCY_RATIO_FAST : KEYBOARD_FREQUENCY_RATIO;
		const current = frequency(handle);
		return Math.round(
			clampAudioEqFrequencyHz(
				direction < 0 ? current / ratio : current * ratio,
				handle.minFrequencyHz,
				handle.maxFrequencyHz,
				handle.defaultFrequencyHz
			)
		);
	}

	function handleKeydown(handle: HandleDefinition, event: KeyboardEvent): void {
		if (
			disabled ||
			!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)
		)
			return;
		if (handle.kind !== 'gain' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) return;
		event.preventDefault();
		event.stopPropagation();
		let patch: Partial<AudioEqSettings>;
		if (event.key === 'Home') patch = resetPatch(handle);
		else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			patch = {
				[handle.frequencyField]: nudgeFrequency(
					handle,
					event.key === 'ArrowLeft' ? -1 : 1,
					event.shiftKey
				)
			};
		} else if (handle.gainField) {
			const step = event.shiftKey ? 1 : KEYBOARD_GAIN_STEP_DB;
			patch = {
				[handle.gainField]:
					Math.round(
						clampAudioEqGainDb(gain(handle) + (event.key === 'ArrowUp' ? step : -step)) * 10
					) / 10
			};
		} else return;
		onbegin();
		onlive(patch);
		oncommit(patch);
	}

	function resetHandle(handle: HandleDefinition): void {
		if (disabled) return;
		const patch = resetPatch(handle);
		onbegin();
		onlive(patch);
		oncommit(patch);
	}
</script>

<div
	bind:this={root}
	class={`relative h-44 w-full touch-none overflow-hidden rounded-md border border-white/10 bg-[oklch(0.18_0.01_50)] select-none ${disabled ? 'opacity-60' : 'cursor-move'}`}
	data-eq-curve-root
	role="group"
	aria-label={m.video_editor_audio_eq_response()}
	onpointermove={moveDrag}
	onpointerup={finishDrag}
	onpointercancel={cancelDrag}
>
	<svg
		viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
		preserveAspectRatio="none"
		class="h-full w-full text-white"
		role="img"
		aria-label={m.video_editor_audio_eq_response()}
	>
		{#each GRID_LEVELS_DB as level (level)}
			<line
				x1={PADDING_X}
				y1={displayDbToY(level)}
				x2={WIDTH - PADDING_X}
				y2={displayDbToY(level)}
				stroke="currentColor"
				stroke-opacity={level === EQ_BASELINE_DB ? 0.28 : 0.1}
				stroke-dasharray={level === EQ_BASELINE_DB ? undefined : '2 3'}
			/>
		{/each}
		{#each GRID_FREQUENCIES_HZ as frequencyHz (frequencyHz)}
			<line
				x1={frequencyToX(frequencyHz)}
				y1={PADDING_TOP}
				x2={frequencyToX(frequencyHz)}
				y2={HEIGHT - PADDING_BOTTOM}
				stroke="currentColor"
				stroke-opacity="0.08"
				stroke-dasharray="2 3"
			/>
		{/each}
		<path
			d={responsePath}
			fill="none"
			stroke="oklch(0.72 0.14 45)"
			stroke-width="2"
			vector-effect="non-scaling-stroke"
		/>
	</svg>

	{#each GRID_LEVELS_DB as level (level)}
		<span
			class="pointer-events-none absolute left-1.5 -translate-y-1/2 text-xs leading-none text-white/35 tabular-nums"
			style={`top: ${(displayDbToY(level) / HEIGHT) * 100}%`}>{level}</span
		>
	{/each}
	{#each GRID_FREQUENCIES_HZ as frequencyHz (frequencyHz)}
		<span
			class="pointer-events-none absolute bottom-1 -translate-x-1/2 text-xs leading-none text-white/40 tabular-nums"
			style={`left: ${(frequencyToX(frequencyHz) / WIDTH) * 100}%`}
			>{formatFrequency(frequencyHz)}</span
		>
	{/each}

	{#if !disabled}
		{#each handles.filter(enabled) as handle (handle.id)}
			<button
				type="button"
				data-eq-band={handle.id}
				class={`absolute flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-black/60 bg-[oklch(0.72_0.14_45)] text-xs font-semibold text-black shadow-sm after:absolute after:-inset-3 after:content-[''] focus-visible:outline-2 focus-visible:outline-[oklch(0.78_0.14_45)] ${drag?.handleId === handle.id ? 'scale-110 bg-white' : ''}`}
				style={`left: ${(frequencyToX(frequency(handle)) / WIDTH) * 100}%; top: ${((handle.kind === 'gain' ? gainToY(gain(handle)) : displayDbToY(EQ_BASELINE_DB)) / HEIGHT) * 100}%`}
				aria-label={`${handle.label} ${m.video_editor_audio_eq_response()}`}
				title={`${handle.label}: ${gain(handle) >= 0 ? '+' : ''}${gain(handle).toFixed(1)} dB @ ${formatFrequency(frequency(handle))} Hz`}
				onpointerdown={(event) => startDrag(handle, event)}
				onkeydown={(event) => handleKeydown(handle, event)}
				ondblclick={() => resetHandle(handle)}
			>
				{handle.number}
			</button>
		{/each}
	{:else}
		<div class="pointer-events-none absolute inset-x-0 top-2 text-center text-xs text-white/45">
			{m.video_editor_property_mixed()}
		</div>
	{/if}
</div>
