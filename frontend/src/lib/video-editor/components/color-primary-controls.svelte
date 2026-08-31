<script lang="ts">
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import PipetteIcon from '@lucide/svelte/icons/pipette';
	import { onMount } from 'svelte';
	import { Slider } from '$lib/components/ui/slider';
	import { m } from '$lib/paraglide/messages';
	import {
		hueAmountFromWheelChannels,
		wheelChannelsFromHueAmount,
		type WheelChannels
	} from '$lib/video-editor/effects/wheel-channels';
	import { getGpuEffect, getGpuEffectDefaultParams } from '$lib/video-editor/effects/gpu/registry';
	import { gpuEffectLabel, gpuParamLabel } from '$lib/video-editor/effects/gpu/i18n';
	import type { GpuEffect } from '$lib/video-editor/effects/types';
	import { colorPreviewStore } from '$lib/video-editor/effects/color-preview-store.svelte';
	import type { ColorPickerKind } from '$lib/video-editor/effects/color-preview-store.svelte';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { upsertGpuEffectParamsOnItems } from '$lib/video-editor/timeline/actions/effects';
	import ColorEffectHeader from './color-effect-header.svelte';
	import ScrubbableNumberInput from './scrubbable-number-input.svelte';

	const EFFECT_ID = 'gpu-color-wheels';
	const MAX_DOCK_WHEEL_SIZE = 200;
	const MIN_DOCK_WHEEL_SIZE = 48;
	const DOCK_WHEEL_GRID_GAP_PX = 28;
	const DOCK_WHEEL_EXTRAS_PX = 76;
	const defaults = getGpuEffectDefaultParams(EFFECT_ID);
	const definition = getGpuEffect(EFFECT_ID)!;

	const wheelDescriptors = [
		{
			hue: 'shadowsHue',
			amount: 'shadowsAmount',
			level: 'lift',
			masterChip: true,
			display: { scale: 1, bias: 0, step: 0.01, decimals: 2 },
			ring: { min: -2, max: 2, fromDeg: 0 }
		},
		{
			hue: 'midtonesHue',
			amount: 'midtonesAmount',
			level: 'gamma',
			masterChip: true,
			display: { scale: 1, bias: -1, step: 0.01, decimals: 2 },
			ring: { min: 0, max: 2, fromDeg: 0 }
		},
		{
			hue: 'highlightsHue',
			amount: 'highlightsAmount',
			level: 'gain',
			masterChip: true,
			display: { scale: 1, bias: 0, step: 0.01, decimals: 2 },
			ring: { min: 0, max: 2, fromDeg: 180 }
		},
		{
			hue: 'offsetHue',
			amount: 'offsetAmount',
			level: 'offset',
			masterChip: false,
			display: { scale: 100, bias: 25, step: 0.25, decimals: 2 },
			ring: { min: -2, max: 2, fromDeg: 0 }
		}
	] as const;
	const channelIndices = [0, 1, 2] as const;
	const channelLabels = ['Red', 'Green', 'Blue'] as const;
	const channelAccents = ['bg-red-500', 'bg-green-500', 'bg-blue-500'] as const;

	const topParameters = ['temperature', 'tint', 'contrast', 'pivot', 'midDetail'] as const;
	const bottomParameters = [
		'colorBoost',
		'shadows',
		'highlights',
		'saturation',
		'hue',
		'lumMix'
	] as const;
	const parameterDisplays = {
		temperature: { scale: 40, bias: 0, step: 10, decimals: 1 },
		tint: { scale: 1, bias: 0, step: 0.1, decimals: 2 },
		contrast: { scale: 1, bias: 0, step: 0.005, decimals: 3 },
		pivot: { scale: 1, bias: 0, step: 0.005, decimals: 3 },
		midDetail: { scale: 1, bias: 0, step: 0.5, decimals: 2 },
		colorBoost: { scale: 1, bias: 0, step: 0.5, decimals: 2 },
		shadows: { scale: 1, bias: 0, step: 0.5, decimals: 2 },
		highlights: { scale: 1, bias: 0, step: 0.5, decimals: 2 },
		saturation: { scale: 0.5, bias: 50, step: 0.5, decimals: 2 },
		hue: { scale: 1, bias: 0, step: 0.5, decimals: 2 },
		lumMix: { scale: 1, bias: 0, step: 0.5, decimals: 2 }
	} satisfies Record<string, { scale: number; bias: number; step: number; decimals: number }>;
	const parameterAccents = {
		temperature: 'neutral',
		contrast: 'neutral',
		pivot: 'neutral',
		lumMix: 'neutral',
		tint: 'hue',
		hue: 'hue',
		saturation: 'rgb',
		colorBoost: 'rgb'
	} satisfies Record<string, string>;

	let {
		itemId,
		itemIds = [],
		onedit,
		onautobalance,
		onpick
	}: {
		itemId: string | null;
		itemIds?: string[];
		onedit: () => void;
		onautobalance?: () => void;
		onpick?: (kind: ColorPickerKind) => void;
	} = $props();

	let wheelDrafts = $state<Record<string, { hue: number; amount: number }>>({});
	let parameterDrafts = $state<Record<string, number>>({});
	let pointerWheel = $state<string | null>(null);
	let wheelGrid: HTMLDivElement | null = $state(null);
	let wheelSize = $state(80);

	onMount(() => {
		if (!wheelGrid) return;
		const updateSize = () => {
			if (!wheelGrid) return;
			const styles = getComputedStyle(wheelGrid);
			const paddingX =
				(Number.parseFloat(styles.paddingLeft) || 0) +
				(Number.parseFloat(styles.paddingRight) || 0);
			const paddingY =
				(Number.parseFloat(styles.paddingTop) || 0) +
				(Number.parseFloat(styles.paddingBottom) || 0);
			const availableWidth = wheelGrid.clientWidth - paddingX;
			const slotWidth =
				(availableWidth - DOCK_WHEEL_GRID_GAP_PX * (wheelDescriptors.length - 1)) /
				wheelDescriptors.length;
			const slotHeight = wheelGrid.clientHeight - paddingY - DOCK_WHEEL_EXTRAS_PX;
			wheelSize = Math.max(
				MIN_DOCK_WHEEL_SIZE,
				Math.min(MAX_DOCK_WHEEL_SIZE, Math.floor(Math.min(slotWidth, slotHeight)))
			);
		};
		updateSize();
		if (!globalThis.ResizeObserver) return;
		const observer = new globalThis.ResizeObserver(updateSize);
		observer.observe(wheelGrid);
		return () => observer.disconnect();
	});

	const item = $derived(itemId ? timelineStore.itemById.get(itemId) : undefined);
	const wheelEffect = $derived(
		item?.effects?.find(
			(effect): effect is GpuEffect => effect.type === 'gpu' && effect.effectId === EFFECT_ID
		)
	);
	const controlsEnabled = $derived(wheelEffect?.enabled !== false);
	const targetItemIds = $derived.by(() => {
		const requested = itemId && itemIds.includes(itemId) ? itemIds : itemId ? [itemId] : [];
		return [...new Set(requested)].filter((id) => timelineStore.itemById.get(id)?.type !== 'audio');
	});

	function schema(name: string) {
		return definition?.schema.find((entry) => entry.name === name);
	}

	function label(name: string): string {
		const param = schema(name);
		return param ? gpuParamLabel(param) : name;
	}

	function read(name: string): number {
		return Number(wheelEffect?.params[name] ?? defaults[name] ?? 0);
	}

	function wheelValue(descriptor: (typeof wheelDescriptors)[number]): {
		hue: number;
		amount: number;
	} {
		return (
			wheelDrafts[descriptor.hue] ?? {
				hue: read(descriptor.hue),
				amount: read(descriptor.amount)
			}
		);
	}

	function parameterValue(name: string): number {
		return parameterDrafts[name] ?? read(name);
	}

	function preview(updates: Record<string, number>): void {
		if (!itemId || !wheelEffect || !controlsEnabled) return;
		const effectIds = targetItemIds.flatMap((id) => {
			const effect = timelineStore.itemById
				.get(id)
				?.effects?.find(
					(candidate) => candidate.type === 'gpu' && candidate.effectId === EFFECT_ID
				);
			return effect?.type === 'gpu' ? [effect.id] : [];
		});
		colorPreviewStore.setEffectDraft(itemId, wheelEffect, updates, effectIds);
	}

	function commit(updates: Record<string, number>): void {
		if (!itemId || !controlsEnabled) return;
		colorPreviewStore.clearEffectDraft(itemId);
		if (upsertGpuEffectParamsOnItems(targetItemIds, EFFECT_ID, updates)) onedit();
	}

	function pointFromPointer(event: PointerEvent) {
		const bounds = event.currentTarget.getBoundingClientRect();
		const centerX = bounds.left + bounds.width / 2;
		const centerY = bounds.top + bounds.height / 2;
		const x = event.clientX - centerX;
		const y = event.clientY - centerY;
		const radius = Math.max(1, bounds.width / 2 - 5);
		return {
			hue: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360,
			amount: Math.max(0, Math.min(1, Math.hypot(x, y) / radius))
		};
	}

	function updateWheel(event: PointerEvent, descriptor: (typeof wheelDescriptors)[number]): void {
		if (pointerWheel !== descriptor.hue) return;
		const value = pointFromPointer(event);
		wheelDrafts[descriptor.hue] = value;
		preview({ [descriptor.hue]: value.hue, [descriptor.amount]: value.amount });
	}

	function startWheel(event: PointerEvent, descriptor: (typeof wheelDescriptors)[number]): void {
		if (!controlsEnabled || event.button !== 0 || pointerWheel) return;
		event.preventDefault();
		pointerWheel = descriptor.hue;
		event.currentTarget.setPointerCapture?.(event.pointerId);
		updateWheel(event, descriptor);
	}

	function finishWheel(event: PointerEvent, descriptor: (typeof wheelDescriptors)[number]): void {
		if (pointerWheel !== descriptor.hue) return;
		updateWheel(event, descriptor);
		const value = wheelValue(descriptor);
		pointerWheel = null;
		commit({ [descriptor.hue]: value.hue, [descriptor.amount]: value.amount });
		delete wheelDrafts[descriptor.hue];
		if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
	}

	function cancelWheel(event: PointerEvent, descriptor: (typeof wheelDescriptors)[number]): void {
		if (pointerWheel !== descriptor.hue) return;
		const value = wheelValue(descriptor);
		pointerWheel = null;
		commit({ [descriptor.hue]: value.hue, [descriptor.amount]: value.amount });
		delete wheelDrafts[descriptor.hue];
		if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
	}

	function changeWheelFromKeyboard(
		event: KeyboardEvent,
		descriptor: (typeof wheelDescriptors)[number]
	): void {
		if (!controlsEnabled) return;
		const current = wheelValue(descriptor);
		let hue = current.hue;
		let amount = current.amount;
		if (event.key === 'ArrowLeft') hue -= 1;
		else if (event.key === 'ArrowRight') hue += 1;
		else if (event.key === 'ArrowDown') amount -= 0.01;
		else if (event.key === 'ArrowUp') amount += 0.01;
		else if (event.key === 'Home') amount = 0;
		else if (event.key === 'End') amount = 1;
		else return;
		event.preventDefault();
		hue = ((hue % 360) + 360) % 360;
		amount = Math.max(0, Math.min(1, amount));
		commit({ [descriptor.hue]: hue, [descriptor.amount]: amount });
	}

	function resetWheel(descriptor: (typeof wheelDescriptors)[number]): void {
		commit({
			[descriptor.hue]: Number(defaults[descriptor.hue] ?? 0),
			[descriptor.amount]: Number(defaults[descriptor.amount] ?? 0),
			[descriptor.level]: Number(defaults[descriptor.level] ?? 0)
		});
	}

	function updateParameter(name: string, value: number): void {
		if (!controlsEnabled) return;
		parameterDrafts[name] = value;
		preview({ [name]: value });
	}

	function commitParameter(name: string, value: number): void {
		if (!controlsEnabled) return;
		delete parameterDrafts[name];
		commit({ [name]: value });
	}

	function cancelParameter(name: string): void {
		delete parameterDrafts[name];
		if (itemId) colorPreviewStore.clearEffectDraft(itemId);
	}

	function parameterDisplay(name: string) {
		const param = schema(name);
		return (
			parameterDisplays[name] ?? {
				scale: 1,
				bias: 0,
				step: Number(param?.step ?? 1),
				decimals: Number(param?.step ?? 1) >= 1 ? 0 : 2
			}
		);
	}

	function displayParameter(name: string): number {
		const display = parameterDisplay(name);
		return parameterValue(name) * display.scale + display.bias;
	}

	function parameterFromDisplay(name: string, value: number): number {
		const display = parameterDisplay(name);
		return normalizeLevel(name, (value - display.bias) / display.scale);
	}

	function parameterDisplayRange(name: string) {
		const param = schema(name);
		const display = parameterDisplay(name);
		return {
			min: Number(param?.min ?? 0) * display.scale + display.bias,
			max: Number(param?.max ?? 0) * display.scale + display.bias
		};
	}

	function resetParameter(name: string): void {
		commitParameter(name, Number(defaults[name] ?? 0));
	}

	function normalizeLevel(name: string, value: number): number {
		const param = schema(name);
		if (!param) return value;
		return Math.min(Number(param.max), Math.max(Number(param.min), value));
	}

	function displayLevel(descriptor: (typeof wheelDescriptors)[number]): number {
		return parameterValue(descriptor.level) * descriptor.display.scale + descriptor.display.bias;
	}

	function levelFromDisplay(descriptor: (typeof wheelDescriptors)[number], value: number): number {
		return normalizeLevel(
			descriptor.level,
			(value - descriptor.display.bias) / descriptor.display.scale
		);
	}

	function displayRange(descriptor: (typeof wheelDescriptors)[number]) {
		const levelSchema = schema(descriptor.level);
		return {
			min: Number(levelSchema?.min ?? 0) * descriptor.display.scale + descriptor.display.bias,
			max: Number(levelSchema?.max ?? 0) * descriptor.display.scale + descriptor.display.bias
		};
	}

	function displayedChannels(descriptor: (typeof wheelDescriptors)[number]): WheelChannels {
		const wheel = wheelValue(descriptor);
		const master = displayLevel(descriptor);
		const deviations = wheelChannelsFromHueAmount(wheel.hue, wheel.amount);
		return [
			master + deviations[0] * descriptor.display.scale,
			master + deviations[1] * descriptor.display.scale,
			master + deviations[2] * descriptor.display.scale
		];
	}

	function updateChannel(
		descriptor: (typeof wheelDescriptors)[number],
		index: 0 | 1 | 2,
		value: number,
		mode: 'live' | 'commit'
	): void {
		const range = displayRange(descriptor);
		const channels = displayedChannels(descriptor);
		channels[index] = Math.max(
			range.min - descriptor.display.scale,
			Math.min(range.max + descriptor.display.scale, value)
		);
		const mean = (channels[0] + channels[1] + channels[2]) / 3;
		const normalizedChannels: WheelChannels = [
			(channels[0] - mean) / descriptor.display.scale,
			(channels[1] - mean) / descriptor.display.scale,
			(channels[2] - mean) / descriptor.display.scale
		];
		const wheel = hueAmountFromWheelChannels(normalizedChannels);
		const updates = {
			[descriptor.level]: Math.round(levelFromDisplay(descriptor, mean) * 10_000) / 10_000,
			[descriptor.hue]: Math.round(wheel.hue * 10) / 10,
			[descriptor.amount]: Math.round(wheel.amount * 1000) / 1000
		};
		if (mode === 'live') {
			parameterDrafts[descriptor.level] = updates[descriptor.level];
			wheelDrafts[descriptor.hue] = {
				hue: updates[descriptor.hue],
				amount: updates[descriptor.amount]
			};
			preview(updates);
			return;
		}
		delete parameterDrafts[descriptor.level];
		delete wheelDrafts[descriptor.hue];
		commit(updates);
	}

	function ringFill(descriptor: (typeof wheelDescriptors)[number]): number {
		return Math.max(
			0,
			Math.min(
				1,
				(parameterValue(descriptor.level) - descriptor.ring.min) /
					Math.max(0.0001, descriptor.ring.max - descriptor.ring.min)
			)
		);
	}
</script>

<section class="flex h-full min-h-0 flex-col" aria-label={gpuEffectLabel(definition)}>
	<ColorEffectHeader
		{itemId}
		{itemIds}
		effectId={EFFECT_ID}
		label={gpuEffectLabel(definition)}
		badge="PRIMARIES"
		{onedit}
	/>

	<div
		class="grid shrink-0 grid-cols-[auto_repeat(5,minmax(0,1fr))] items-center gap-x-1 border-b border-white/10 px-2 py-1.5 2xl:gap-x-3 2xl:px-4"
	>
		<div class="flex items-center gap-0.5 pr-1">
			<button
				type="button"
				class="parameter-tool"
				disabled={!itemId || !onautobalance || !controlsEnabled}
				title={m.video_editor_color_auto_balance()}
				aria-label={m.video_editor_color_auto_balance()}
				onclick={() => onautobalance?.()}
			>
				<span
					class="flex size-3.5 items-center justify-center rounded-full border border-current text-[8px] leading-none font-semibold"
					>A</span
				>
			</button>
			<button
				type="button"
				class="parameter-tool"
				disabled={!itemId || !onpick || !controlsEnabled}
				title={m.video_editor_color_pick_white_balance()}
				aria-label={m.video_editor_color_pick_white_balance()}
				onclick={() => onpick?.('white-balance')}
			>
				<PipetteIcon class="size-3.5" />
			</button>
			<button
				type="button"
				class="parameter-tool"
				disabled={!itemId || !onpick || !controlsEnabled}
				title={m.video_editor_color_pick_black_point()}
				aria-label={m.video_editor_color_pick_black_point()}
				onclick={() => onpick?.('black-point')}
			>
				<span class="relative">
					<PipetteIcon class="size-3.5" />
					<span
						class="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full border border-zinc-500 bg-black"
					></span>
				</span>
			</button>
			<button
				type="button"
				class="parameter-tool"
				disabled={!itemId || !onpick || !controlsEnabled}
				title={m.video_editor_color_pick_white_point()}
				aria-label={m.video_editor_color_pick_white_point()}
				onclick={() => onpick?.('white-point')}
			>
				<span class="relative">
					<PipetteIcon class="size-3.5" />
					<span
						class="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full border border-zinc-600 bg-white"
					></span>
				</span>
			</button>
		</div>
		{#each topParameters as name (name)}
			{@const param = schema(name)}
			{@const display = parameterDisplay(name)}
			{@const range = parameterDisplayRange(name)}
			{#if param}
				<div class="parameter-control">
					<span class="parameter-label" title={gpuParamLabel(param)}>{gpuParamLabel(param)}</span>
					<span class="flex min-w-0 flex-col items-center">
						<ScrubbableNumberInput
							disabled={!controlsEnabled}
							ariaLabel={gpuParamLabel(param)}
							value={displayParameter(name)}
							min={range.min}
							max={range.max}
							step={display.step}
							decimals={display.decimals}
							class="parameter-chip"
							onlive={(next) => updateParameter(name, parameterFromDisplay(name, next))}
							oncommit={(next) => commitParameter(name, parameterFromDisplay(name, next))}
						/>
						<span class="parameter-accent {parameterAccents[name] ?? 'tonal'}" aria-hidden="true"
						></span>
					</span>
					<button
						type="button"
						class="parameter-reset"
						disabled={!controlsEnabled ||
							Object.is(parameterValue(name), Number(defaults[name] ?? 0))}
						title={`Reset ${gpuParamLabel(param)}`}
						aria-label={`Reset ${gpuParamLabel(param)}`}
						onclick={() => resetParameter(name)}
					>
						<RotateCcwIcon class="size-2.5" />
					</button>
				</div>
			{/if}
		{/each}
	</div>

	<div
		bind:this={wheelGrid}
		class="grid min-h-0 flex-1 grid-cols-4 items-center gap-1.5 overflow-hidden px-3 py-2 2xl:gap-7 2xl:px-6 2xl:py-3"
	>
		{#each wheelDescriptors as descriptor (descriptor.hue)}
			{@const value = wheelValue(descriptor)}
			{@const levelSchema = schema(descriptor.level)}
			{@const levelRange = displayRange(descriptor)}
			{@const channels = displayedChannels(descriptor)}
			<div class="flex min-h-0 min-w-0 flex-col items-center gap-1.5">
				<div class="flex h-5 items-center justify-center gap-1">
					<span class="truncate text-[10px] font-semibold">{label(descriptor.level)}</span>
					<button
						type="button"
						disabled={!controlsEnabled}
						class="flex size-5 items-center justify-center rounded text-white/45 hover:bg-white/8 hover:text-white focus-visible:outline-2 focus-visible:outline-orange-400"
						aria-label={`Reset ${label(descriptor.level)}`}
						title={`Reset ${label(descriptor.level)}`}
						onclick={() => resetWheel(descriptor)}
					>
						<RotateCcwIcon class="size-3" />
					</button>
				</div>
				<div
					class="relative shrink-0"
					style:width={`${wheelSize}px`}
					style:height={`${wheelSize}px`}
				>
					<button
						type="button"
						disabled={!controlsEnabled}
						class="color-wheel absolute inset-2 touch-none rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400 disabled:cursor-not-allowed disabled:opacity-45"
						style:--wheel-hue={`${value.hue}deg`}
						style:--wheel-amount={value.amount}
						style:--ring-fill={`${ringFill(descriptor) * 360}deg`}
						style:--ring-from={`${descriptor.ring.fromDeg}deg`}
						role="slider"
						aria-label={`${label(descriptor.level)} color wheel`}
						aria-valuemin="0"
						aria-valuemax="100"
						aria-valuenow={Math.round(value.amount * 100)}
						aria-valuetext={`${Math.round(value.hue)} degrees, ${Math.round(value.amount * 100)} percent`}
						onpointerdown={(event) => startWheel(event, descriptor)}
						onpointermove={(event) => updateWheel(event, descriptor)}
						onpointerup={(event) => finishWheel(event, descriptor)}
						onpointercancel={(event) => cancelWheel(event, descriptor)}
						onkeydown={(event) => changeWheelFromKeyboard(event, descriptor)}
					>
						<span class="wheel-cross wheel-cross-x"></span>
						<span class="wheel-cross wheel-cross-y"></span>
						<span class="wheel-puck"></span>
					</button>
				</div>
				{#if levelSchema}
					<div
						class="grid w-full gap-px px-0.5 2xl:gap-1 2xl:px-1 {descriptor.masterChip
							? 'grid-cols-4'
							: 'grid-cols-3'}"
					>
						{#if descriptor.masterChip}
							<span class="flex min-w-0 flex-col items-center">
								<ScrubbableNumberInput
									disabled={!controlsEnabled}
									ariaLabel={`${label(descriptor.level)} master`}
									value={displayLevel(descriptor)}
									min={levelRange.min}
									max={levelRange.max}
									step={descriptor.display.step}
									decimals={descriptor.display.decimals}
									class="wheel-chip"
									onlive={(next) =>
										updateParameter(descriptor.level, levelFromDisplay(descriptor, next))}
									oncommit={(next) =>
										commitParameter(descriptor.level, levelFromDisplay(descriptor, next))}
								/>
								<span class="mt-0.5 h-0.5 w-5 rounded-full bg-zinc-200"></span>
							</span>
						{/if}
						{#each channelIndices as channelIndex (channelIndex)}
							<span class="flex min-w-0 flex-col items-center">
								<ScrubbableNumberInput
									disabled={!controlsEnabled}
									ariaLabel={`${label(descriptor.level)} ${channelLabels[channelIndex]}`}
									value={channels[channelIndex]}
									min={levelRange.min - descriptor.display.scale}
									max={levelRange.max + descriptor.display.scale}
									step={descriptor.display.step}
									decimals={descriptor.display.decimals}
									class="wheel-chip"
									onlive={(next) => updateChannel(descriptor, channelIndex, next, 'live')}
									oncommit={(next) => updateChannel(descriptor, channelIndex, next, 'commit')}
								/>
								<span class="mt-0.5 h-0.5 w-5 rounded-full {channelAccents[channelIndex]}"></span>
							</span>
						{/each}
					</div>
					<Slider
						disabled={!controlsEnabled}
						class="wheel-thumb [&_[data-slot=slider-thumb]]:shadow-none"
						min={levelRange.min}
						max={levelRange.max}
						step={descriptor.display.step}
						value={displayLevel(descriptor)}
						ariaLabel={`${label(descriptor.level)} thumb wheel`}
						onValueChange={(nextValue) =>
							updateParameter(descriptor.level, levelFromDisplay(descriptor, nextValue))}
						onValueCommit={(nextValue) =>
							commitParameter(descriptor.level, levelFromDisplay(descriptor, nextValue))}
						onValueCancel={() => cancelParameter(descriptor.level)}
						onKeydown={(event) => event.stopPropagation()}
					/>
				{/if}
			</div>
		{/each}
	</div>

	<div
		class="grid shrink-0 grid-cols-6 items-center gap-x-1 border-t border-white/10 px-2 py-1.5 2xl:gap-x-3 2xl:px-4"
	>
		{#each bottomParameters as name (name)}
			{@const param = schema(name)}
			{@const display = parameterDisplay(name)}
			{@const range = parameterDisplayRange(name)}
			{#if param}
				<div class="parameter-control">
					<span class="parameter-label" title={gpuParamLabel(param)}>{gpuParamLabel(param)}</span>
					<span class="flex min-w-0 flex-col items-center">
						<ScrubbableNumberInput
							disabled={!controlsEnabled}
							ariaLabel={gpuParamLabel(param)}
							value={displayParameter(name)}
							min={range.min}
							max={range.max}
							step={display.step}
							decimals={display.decimals}
							class="parameter-chip"
							onlive={(next) => updateParameter(name, parameterFromDisplay(name, next))}
							oncommit={(next) => commitParameter(name, parameterFromDisplay(name, next))}
						/>
						<span class="parameter-accent {parameterAccents[name] ?? 'tonal'}" aria-hidden="true"
						></span>
					</span>
					<button
						type="button"
						class="parameter-reset"
						disabled={!controlsEnabled ||
							Object.is(parameterValue(name), Number(defaults[name] ?? 0))}
						title={`Reset ${gpuParamLabel(param)}`}
						aria-label={`Reset ${gpuParamLabel(param)}`}
						onclick={() => resetParameter(name)}
					>
						<RotateCcwIcon class="size-2.5" />
					</button>
				</div>
			{/if}
		{/each}
	</div>
</section>

<style>
	.parameter-tool {
		display: flex;
		height: 1.5rem;
		width: 1.5rem;
		align-items: center;
		justify-content: center;
		color: rgb(255 255 255 / 50%);
	}

	.parameter-tool:hover:not(:disabled),
	.parameter-reset:hover:not(:disabled) {
		background: rgb(255 255 255 / 8%);
		color: white;
	}

	.parameter-tool:focus-visible,
	.parameter-reset:focus-visible {
		outline: 2px solid rgb(251 146 60);
		outline-offset: 1px;
	}

	.parameter-tool:disabled,
	.parameter-reset:disabled {
		cursor: not-allowed;
		opacity: 0.35;
	}

	.parameter-control {
		display: grid;
		min-width: 0;
		grid-template-columns: minmax(0, 1fr) 1rem;
		align-items: center;
		column-gap: 0.125rem;
	}

	.parameter-label {
		grid-column: 1 / -1;
		min-width: 0;
		overflow: hidden;
		color: rgb(255 255 255 / 45%);
		font-size: 0.5rem;
		text-align: center;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.parameter-reset {
		display: flex;
		height: 1rem;
		width: 1rem;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		color: rgb(255 255 255 / 42%);
	}

	:global(.parameter-chip) {
		height: 1.5rem;
		width: 100%;
		min-width: 0;
		border: 1px solid rgb(0 0 0 / 80%);
		border-radius: 2px;
		background: rgb(0 0 0 / 75%);
		padding-inline: 0.125rem;
		color: rgb(255 255 255 / 82%);
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.625rem;
		font-variant-numeric: tabular-nums;
		text-align: center;
		outline: none;
	}

	:global(.parameter-chip:focus-visible) {
		border-color: rgb(251 146 60);
		box-shadow: 0 0 0 1px rgb(251 146 60 / 55%);
	}

	.parameter-accent {
		margin-top: 0.125rem;
		height: 0.125rem;
		width: 2rem;
		border-radius: 999px;
		background: linear-gradient(90deg, #d4d4d8, #ef4444, #3b82f6);
	}

	.parameter-accent.neutral {
		background: linear-gradient(90deg, #e4e4e7, #71717a, #18181b);
	}

	.parameter-accent.hue {
		background: linear-gradient(90deg, #22d3ee, #d946ef, #fcd34d);
	}

	.parameter-accent.rgb {
		background: linear-gradient(90deg, #ef4444, #22c55e, #3b82f6);
	}

	@media (min-width: 1536px) {
		.parameter-control {
			grid-template-columns: minmax(3.75rem, 1fr) 3.75rem 1rem;
		}

		.parameter-label {
			grid-column: auto;
			font-size: 0.625rem;
			text-align: right;
		}
	}

	.color-wheel {
		background:
			radial-gradient(
				circle closest-side,
				rgb(19 19 22 / 94%) 0%,
				rgb(19 19 22 / 90%) 62%,
				rgb(19 19 22 / 72%) 80%,
				rgb(19 19 22 / 25%) 88%,
				transparent 94%
			),
			conic-gradient(
				from 90deg,
				#ff3b30,
				#ff9500,
				#ffcc00,
				#34c759,
				#00c7be,
				#007aff,
				#5856d6,
				#ff2d55,
				#ff3b30
			);
		border: 1px solid rgb(255 255 255 / 18%);
		box-shadow: inset 0 0 0 1px rgb(255 255 255 / 7%);
	}

	.color-wheel::before {
		position: absolute;
		inset: -8px;
		border-radius: 999px;
		background: conic-gradient(from var(--ring-from), #e4e4e9 var(--ring-fill), #060607 0);
		content: '';
		mask: radial-gradient(transparent 66%, black 68% 76%, transparent 78%);
		pointer-events: none;
	}

	.wheel-cross {
		position: absolute;
		background: rgb(255 255 255 / 14%);
		pointer-events: none;
	}

	.wheel-cross-x {
		top: 3%;
		bottom: 3%;
		left: 50%;
		width: 1px;
	}

	.wheel-cross-y {
		left: 3%;
		right: 3%;
		top: 50%;
		height: 1px;
	}

	.wheel-puck {
		position: absolute;
		left: calc(50% + cos(var(--wheel-hue)) * var(--wheel-amount) * 39%);
		top: calc(50% + sin(var(--wheel-hue)) * var(--wheel-amount) * 39%);
		width: 10px;
		height: 10px;
		translate: -50% -50%;
		border: 2px solid white;
		border-radius: 999px;
		background: #f8fafc;
		box-shadow: 0 1px 4px rgb(0 0 0 / 80%);
		pointer-events: none;
	}

	:global(.wheel-chip) {
		height: 1.25rem;
		width: 100%;
		min-width: 0;
		border: 1px solid rgb(0 0 0 / 80%);
		border-radius: 2px;
		background: rgb(0 0 0 / 75%);
		padding-inline: 0;
		color: rgb(255 255 255 / 82%);
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.5rem;
		font-variant-numeric: tabular-nums;
		text-align: center;
		outline: none;
	}

	:global(.wheel-chip:focus-visible) {
		border-color: rgb(251 146 60);
		box-shadow: 0 0 0 1px rgb(251 146 60 / 55%);
	}

	:global(.wheel-thumb) {
		margin-top: 0.125rem;
		height: 0.65rem;
		width: 100%;
		cursor: ew-resize;
	}

	:global(.wheel-thumb [data-slot='slider-track']) {
		height: 0.65rem;
		border: 1px solid rgb(0 0 0 / 80%);
		border-radius: 999px;
		background: repeating-linear-gradient(
			90deg,
			rgb(255 255 255 / 22%) 0 1px,
			rgb(0 0 0 / 65%) 1px 5px
		);
	}

	:global(.wheel-thumb [data-slot='slider-range']) {
		background: transparent;
	}

	:global(.wheel-thumb [data-slot='slider-thumb']) {
		border: 0;
		background: transparent;
		box-shadow: none;
	}

	:global(.wheel-thumb [data-slot='slider-thumb'])::after {
		display: block;
		height: 0.7rem;
		width: 0.7rem;
		border: 1px solid rgb(0 0 0 / 80%);
		border-radius: 999px;
		background: rgb(228 228 231);
	}

	@media (pointer: coarse) {
		:global(.wheel-thumb) {
			height: 2.75rem;
		}

		.color-wheel {
			min-width: 4.5rem;
			min-height: 4.5rem;
		}
	}
</style>
