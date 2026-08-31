<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Slider } from '$lib/components/ui/slider';
	import AppSelect from '$lib/components/app-select.svelte';
	import type {
		TimelineTransition,
		TransitionDirection,
		TransitionPropertyValue,
		TransitionTiming
	} from '$lib/video-editor/project/types';
	import {
		removeTransition,
		transitionsStore,
		updateTransition,
		updateTransitionPresentation
	} from '$lib/video-editor/timeline/actions/transitions.svelte';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { getMaxTransitionDuration } from '$lib/video-editor/timeline/transition-planner';
	import { transitionRegistry } from '$lib/video-editor/transitions';
	import { localizedTransitionLabel } from '$lib/video-editor/transitions/labels';
	import type {
		TransitionCategory,
		TransitionDefinition,
		TransitionParameterDefinition
	} from '$lib/video-editor/transitions/types';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';

	let {
		transitionId,
		onedit,
		onremove = () => {}
	}: {
		transitionId: string;
		onedit: () => void;
		onremove?: () => void;
	} = $props();

	let search = $state('');
	const transition = $derived(
		transitionsStore.list.find((candidate) => candidate.id === transitionId)
	);
	const definition = $derived(
		transitionRegistry.getDefinition(transition?.presentation ?? 'fade') ??
			transitionRegistry.getDefinition('fade')
	);
	const definitions = transitionRegistry.getDefinitions();
	const categories = [
		'basic',
		'dissolve',
		'motion',
		'wipe',
		'slide',
		'flip',
		'mask',
		'iris',
		'shape',
		'light',
		'chromatic',
		'custom'
	] satisfies TransitionCategory[];

	const parameterLabels = {
		Blur: m.video_editor_transition_parameter_blur,
		Blocks: m.video_editor_transition_parameter_blocks,
		Burn: m.video_editor_transition_parameter_burn,
		Chroma: m.video_editor_transition_parameter_chroma,
		Color: m.video_editor_transition_parameter_color,
		Density: m.video_editor_transition_parameter_density,
		Dim: m.video_editor_transition_parameter_dim,
		Exposure: m.video_editor_transition_parameter_exposure,
		'Gate Width': m.video_editor_transition_parameter_gate_width,
		Glow: m.video_editor_transition_parameter_glow,
		Grain: m.video_editor_transition_parameter_grain,
		Intensity: m.video_editor_transition_parameter_intensity,
		'Block Size': m.video_editor_transition_parameter_block_size,
		'RGB Split': m.video_editor_transition_parameter_rgb_split,
		Roll: m.video_editor_transition_parameter_roll,
		Scale: m.video_editor_transition_parameter_scale,
		Shake: m.video_editor_transition_parameter_shake,
		Shine: m.video_editor_transition_parameter_shine,
		Size: m.video_editor_transition_parameter_size,
		Slip: m.video_editor_transition_parameter_slip,
		Softness: m.video_editor_transition_parameter_softness,
		Spin: m.video_editor_transition_parameter_spin,
		Spread: m.video_editor_transition_parameter_spread,
		Strength: m.video_editor_transition_parameter_strength,
		Swirl: m.video_editor_transition_parameter_swirl,
		Turbulence: m.video_editor_transition_parameter_turbulence,
		Vignette: m.video_editor_transition_parameter_vignette,
		Warmth: m.video_editor_transition_parameter_warmth,
		Warp: m.video_editor_transition_parameter_warp,
		Zoom: m.video_editor_transition_parameter_zoom
	};

	function transitionLabel(item: TransitionDefinition): string {
		return localizedTransitionLabel(item.id, item.label);
	}

	function categoryLabel(category: TransitionCategory): string {
		const labels = {
			basic: m.video_editor_transition_category_basic,
			dissolve: m.video_editor_transition_category_dissolve,
			motion: m.video_editor_transition_category_motion,
			wipe: m.video_editor_transition_category_wipe,
			slide: m.video_editor_transition_category_slide,
			flip: m.video_editor_transition_category_flip,
			mask: m.video_editor_transition_category_mask,
			iris: m.video_editor_transition_category_iris,
			// oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- Message key matches the transition domain category.
			shape: m.video_editor_transition_category_shape,
			light: m.video_editor_transition_category_light,
			chromatic: m.video_editor_transition_category_chromatic,
			custom: m.video_editor_transition_category_custom
		};
		return labels[category]();
	}

	function parameterLabel(parameter: TransitionParameterDefinition): string {
		// SAFETY: Registry labels outside this closed localization map use their own fallback label.
		const key = parameter.label as keyof typeof parameterLabels;
		return parameterLabels[key]?.() ?? parameter.label;
	}

	function filteredDefinitions(category: TransitionCategory): TransitionDefinition[] {
		const query = search.trim().toLocaleLowerCase();
		return definitions.filter(
			(candidate) =>
				candidate.category === category &&
				(!query ||
					[
						candidate.id,
						transitionLabel(candidate),
						candidate.description,
						candidate.category,
						categoryLabel(candidate.category),
						...(candidate.directions ?? [])
					]
						.filter(Boolean)
						.some((value) => String(value).toLocaleLowerCase().includes(query)))
		);
	}
	const hasFilteredResults = $derived(
		categories.some((category) => filteredDefinitions(category).length > 0)
	);

	function pairFor(current: TimelineTransition) {
		const outgoing = timelineStore.itemById.get(current.fromItemId);
		const incoming = timelineStore.itemById.get(current.toItemId);
		return outgoing && incoming ? { outgoing, incoming } : null;
	}

	function maxDuration(current: TimelineTransition, alignment = current.alignment ?? 0.5): number {
		const pair = pairFor(current);
		if (!pair) return current.durationInFrames;
		return getMaxTransitionDuration(pair.outgoing, pair.incoming, alignment, timelineStore.fps);
	}

	function commit(updates: Parameters<typeof updateTransition>[1]): void {
		if (updateTransition(transitionId, updates)) onedit();
	}

	function choosePresentation(nextDefinition: TransitionDefinition): void {
		if (updateTransitionPresentation(transitionId, nextDefinition.id)) onedit();
	}

	function setPlacement(alignment: number): void {
		if (!transition) return;
		if (maxDuration(transition, alignment) < transition.durationInFrames) return;
		commit({ alignment });
	}

	function resetDuration(): void {
		if (!transition || !definition) return;
		const available = maxDuration(transition);
		const durationInFrames = Math.max(
			definition.minDuration,
			Math.min(available, definition.maxDuration, definition.defaultDuration)
		);
		commit({ durationInFrames });
	}

	function propertyValue(parameter: TransitionParameterDefinition): TransitionPropertyValue {
		return transition?.properties?.[parameter.key] ?? parameter.defaultValue;
	}

	function setProperty(
		parameter: TransitionParameterDefinition,
		value: TransitionPropertyValue
	): void {
		if (!transition) return;
		commit({ properties: { ...transition.properties, [parameter.key]: value } });
	}

	function parameterAtDefault(parameter: TransitionParameterDefinition): boolean {
		return JSON.stringify(propertyValue(parameter)) === JSON.stringify(parameter.defaultValue);
	}

	function resetProperty(parameter: TransitionParameterDefinition): void {
		// SAFETY: Transition array defaults are already validated against the parameter schema.
		const value = Array.isArray(parameter.defaultValue)
			? ([...parameter.defaultValue] as TransitionPropertyValue)
			: parameter.defaultValue;
		setProperty(parameter, value);
	}

	function rgbToHex(value: TransitionPropertyValue): string {
		if (!Array.isArray(value)) return '#000000';
		return `#${value
			.map((channel) =>
				Math.round(Math.min(1, Math.max(0, channel)) * 255)
					.toString(16)
					.padStart(2, '0')
			)
			.join('')}`;
	}

	function hexToRgb(value: string): [number, number, number] {
		return [
			Number.parseInt(value.slice(1, 3), 16) / 255,
			Number.parseInt(value.slice(3, 5), 16) / 255,
			Number.parseInt(value.slice(5, 7), 16) / 255
		];
	}

	function remove(): void {
		removeTransition(transitionId);
		onedit();
		onremove();
	}

	const timingOptions = $derived(
		(definition?.supportedTimings ?? ['linear']).map((timing) => ({
			value: timing,
			label:
				timing === 'ease-in'
					? m.video_editor_keyframe_easing_in()
					: timing === 'ease-out'
						? m.video_editor_keyframe_easing_out()
						: timing === 'ease-in-out'
							? m.video_editor_keyframe_easing_in_out()
							: timing === 'cubic-bezier'
								? m.video_editor_keyframe_easing_bezier()
								: m.video_editor_keyframe_easing_linear()
		}))
	);

	const directionOptions = [
		{ value: 'from-left', label: m.video_editor_transition_direction_from_left() },
		{ value: 'from-right', label: m.video_editor_transition_direction_from_right() },
		{ value: 'from-top', label: m.video_editor_transition_direction_from_top() },
		{ value: 'from-bottom', label: m.video_editor_transition_direction_from_bottom() }
	];
</script>

{#if transition && definition}
	<section class="flex flex-col gap-2" aria-label={m.video_editor_transition_properties()}>
		<h3 class="px-1 text-xs font-medium tracking-wide text-[oklch(0.65_0.015_55)] uppercase">
			{m.video_editor_transition_properties()}
		</h3>

		<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
			{m.video_editor_transition_preset()}
			<Input
				class="mt-1 h-8 w-full bg-[oklch(0.22_0.01_50)] text-xs"
				type="search"
				placeholder={m.video_editor_transition_search()}
				aria-label={m.video_editor_transition_search()}
				bind:value={search}
			/>
		</label>
		<div class="max-h-52 overflow-y-auto rounded border border-[oklch(0.28_0.015_55)] p-1">
			{#if !hasFilteredResults}
				<p class="p-2 text-xs text-[oklch(0.65_0.015_55)]">
					{m.video_editor_transition_no_results()}
				</p>
			{/if}
			{#each categories as category}
				{@const matches = filteredDefinitions(category)}
				{#if matches.length > 0}
					<h4
						class="px-1 pt-1 text-[9px] font-semibold tracking-wide text-[oklch(0.57_0.015_55)] uppercase"
					>
						{categoryLabel(category)}
					</h4>
					<div class="grid grid-cols-2 gap-1 py-1">
						{#each matches as candidate (candidate.id)}
							<button
								type="button"
								class="min-h-8 rounded px-1.5 py-1 text-left text-[10px] leading-tight hover:bg-[oklch(0.28_0.015_50)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] data-[selected=true]:bg-[oklch(0.66_0.14_45_/_0.2)] data-[selected=true]:text-[oklch(0.88_0.09_65)]"
								data-selected={candidate.id === definition.id}
								aria-pressed={candidate.id === definition.id}
								onclick={() => choosePresentation(candidate)}
							>
								{transitionLabel(candidate)}
							</button>
						{/each}
					</div>
				{/if}
			{/each}
		</div>

		<div class="text-[10px] text-[oklch(0.7_0.01_55)]">
			<span class="flex justify-between">
				<span>{m.video_editor_transition_duration()}</span>
				<span class="font-mono"
					>{transition.durationInFrames} {m.video_editor_transition_frames()}</span
				>
			</span>
			<div class="mt-1 flex items-center gap-1">
				<Slider
					class="min-w-0 flex-1"
					min={Math.min(definition.minDuration, maxDuration(transition))}
					max={Math.max(2, Math.min(definition.maxDuration, maxDuration(transition)))}
					step={1}
					value={transition.durationInFrames}
					ariaLabel={m.video_editor_transition_duration()}
					onValueChange={(value) => commit({ durationInFrames: Math.round(value) })}
				/>
				<Button
					size="icon"
					variant="ghost"
					class="size-7 shrink-0"
					aria-label={m.video_editor_motion_override_reset({
						name: m.video_editor_transition_duration()
					})}
					onclick={resetDuration}
				>
					<RotateCcwIcon class="size-3.5" />
				</Button>
			</div>
		</div>

		<fieldset>
			<legend class="text-[10px] text-[oklch(0.7_0.01_55)]">
				{m.video_editor_transition_placement()}
			</legend>
			<div class="mt-1 grid grid-cols-3 gap-1">
				{#each [{ value: 1, label: m.video_editor_transition_placement_outgoing() }, { value: 0.5, label: m.video_editor_transition_placement_center() }, { value: 0, label: m.video_editor_transition_placement_incoming() }] as placement (placement.value)}
					{@const placementAvailable = maxDuration(transition, placement.value)}
					<Button
						size="sm"
						variant={(transition.alignment ?? 0.5) === placement.value ? 'secondary' : 'outline'}
						class="h-auto min-h-8 px-1 text-[9px] leading-tight"
						disabled={placementAvailable < transition.durationInFrames}
						onclick={() => setPlacement(placement.value)}
					>
						{placement.label}
					</Button>
				{/each}
			</div>
		</fieldset>

		<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
			{m.video_editor_transition_timing()}
			<AppSelect
				class="mt-1 h-8 w-full text-xs"
				value={transition.timing ?? 'linear'}
				options={timingOptions}
				ariaLabel={m.video_editor_transition_timing()}
				onValueChange={(value) => commit({ timing: value as TransitionTiming })}
			/>
		</label>

		{#if transition.timing === 'cubic-bezier'}
			<div class="grid grid-cols-4 gap-1">
				{#each ['x1', 'y1', 'x2', 'y2'] as point}
					<label class="text-[9px] text-[oklch(0.65_0.015_55)]">
						{point}
						<Input
							class="mt-0.5 h-7 px-1 text-[10px]"
							type="number"
							min="0"
							max="1"
							step="0.01"
							value={transition.bezierPoints?.[point as 'x1' | 'y1' | 'x2' | 'y2'] ??
								(point === 'x1' ? 0.25 : point === 'y1' ? 0.1 : point === 'x2' ? 0.25 : 1)}
							onchange={(event) =>
								commit({
									bezierPoints: {
										x1: transition.bezierPoints?.x1 ?? 0.25,
										y1: transition.bezierPoints?.y1 ?? 0.1,
										x2: transition.bezierPoints?.x2 ?? 0.25,
										y2: transition.bezierPoints?.y2 ?? 1,
										[point]: Math.min(1, Math.max(0, event.currentTarget.valueAsNumber))
									}
								})}
						/>
					</label>
				{/each}
			</div>
		{/if}

		{#if definition.hasDirection}
			<label class="text-[10px] text-[oklch(0.7_0.01_55)]">
				{m.video_editor_transition_direction()}
				<AppSelect
					class="mt-1 h-8 w-full text-xs"
					value={transition.direction ?? definition.directions?.[0] ?? 'from-left'}
					options={directionOptions.filter((option) =>
						definition.directions?.includes(option.value as TransitionDirection)
					)}
					ariaLabel={m.video_editor_transition_direction()}
					onValueChange={(value) => commit({ direction: value as TransitionDirection })}
				/>
			</label>
		{/if}

		{#if definition.parameters?.length}
			<div class="flex flex-col gap-2 border-t border-[oklch(0.25_0.015_55)] pt-2">
				{#each definition.parameters as parameter (parameter.key)}
					<div class="flex items-end gap-1">
						{#if parameter.type === 'color'}
							<label
								class="flex min-w-0 flex-1 items-center justify-between text-[10px] text-[oklch(0.7_0.01_55)]"
							>
								{parameterLabel(parameter)}
								<Input
									class="h-8 w-14 p-1"
									type="color"
									value={rgbToHex(propertyValue(parameter))}
									oninput={(event) => setProperty(parameter, hexToRgb(event.currentTarget.value))}
								/>
							</label>
						{:else}
							<label class="min-w-0 flex-1 text-[10px] text-[oklch(0.7_0.01_55)]">
								<span class="flex justify-between">
									<span>{parameterLabel(parameter)}</span>
									<span class="font-mono">{propertyValue(parameter)}{parameter.unit ?? ''}</span>
								</span>
								<Slider
									class="mt-1"
									min={parameter.min ?? 0}
									max={parameter.max ?? 1}
									step={parameter.step ?? 0.01}
									value={propertyValue(parameter) as number}
									ariaLabel={parameterLabel(parameter)}
									onValueChange={(value) => setProperty(parameter, value)}
								/>
							</label>
						{/if}
						<Button
							size="icon"
							variant="ghost"
							class="size-7 shrink-0"
							disabled={parameterAtDefault(parameter)}
							aria-label={m.video_editor_motion_override_reset({
								name: parameterLabel(parameter)
							})}
							onclick={() => resetProperty(parameter)}
						>
							<RotateCcwIcon class="size-3.5" />
						</Button>
					</div>
				{/each}
				<Button
					size="sm"
					variant="ghost"
					class="justify-start"
					onclick={() => commit({ properties: defaultProperties(definition) })}
				>
					<RotateCcwIcon class="size-3.5" />
					{m.video_editor_transition_reset_parameters()}
				</Button>
			</div>
		{/if}

		<Button size="sm" variant="outline" class="mt-1 justify-start" onclick={remove}>
			<Trash2Icon class="size-3.5" />
			{m.video_editor_transition_delete()}
		</Button>
	</section>
{/if}
