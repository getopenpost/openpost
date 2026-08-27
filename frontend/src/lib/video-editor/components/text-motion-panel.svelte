<script lang="ts">
	import AppSelect from '$lib/components/app-select.svelte';
	import { Slider } from '$lib/components/ui/slider';
	import { m } from '$lib/paraglide/messages';
	import type {
		TextMotionEffect,
		TextMotionOrder,
		TextMotionPresetId,
		TextMotionSlot,
		TextMotionUnit
	} from '$lib/video-editor/project/types';
	import type { TimelineSnapshot } from '$lib/video-editor/timeline/commands/types';
	import {
		createTextMotionEffect,
		getTextMotionPreset,
		TEXT_MOTION_IN_PRESETS,
		TEXT_MOTION_LOOP_PRESETS,
		TEXT_MOTION_OUT_PRESETS
	} from '$lib/video-editor/timeline/text-motion-presets';
	import type { TextMotionPreset } from '$lib/video-editor/timeline/text-motion-types';
	import {
		applyTextMotionToItems,
		beginTextMotionEdit,
		commitTextMotionEdit,
		removeTextMotionFromItems,
		updateTextMotionLive,
		type TextMotionEffectUpdate
	} from '$lib/video-editor/timeline/actions/text-motion';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';

	let {
		itemId,
		itemIds = [],
		onedit
	}: { itemId: string | null; itemIds?: string[]; onedit: () => void } = $props();
	const slots: readonly TextMotionSlot[] = ['in', 'out', 'loop'];
	const units: readonly TextMotionUnit[] = ['character', 'word', 'line', 'whole-clip'];
	const orders: readonly TextMotionOrder[] = ['forward', 'backward', 'center', 'random'];
	const catalog = {
		in: TEXT_MOTION_IN_PRESETS,
		out: TEXT_MOTION_OUT_PRESETS,
		loop: TEXT_MOTION_LOOP_PRESETS
	} satisfies Record<TextMotionSlot, readonly TextMotionPreset[]>;
	const selectedTextItems = $derived(
		[...new Set(itemId ? [itemId, ...itemIds] : itemIds)].flatMap((id) => {
			const item = timelineStore.itemById.get(id);
			return item?.type === 'text' ? [item] : [];
		})
	);
	const selectedTextIds = $derived(selectedTextItems.map((item) => item.id));
	const firstSpec = $derived(selectedTextItems[0]?.textMotion);
	let editSnapshot = $state<TimelineSnapshot | null>(null);
	let editSlot = $state<TextMotionSlot | null>(null);

	const presetLabels = $derived<Record<TextMotionPresetId, string>>({
		typewriter: m.video_editor_text_motion_typewriter(),
		'fade-up': m.video_editor_text_motion_fade_up(),
		rise: m.video_editor_text_motion_rise(),
		cascade: m.video_editor_text_motion_cascade(),
		pop: m.video_editor_text_motion_pop(),
		'blur-in': m.video_editor_text_motion_blur_in(),
		'slide-mask': m.video_editor_text_motion_slide_mask(),
		'wave-in': m.video_editor_text_motion_wave_in(),
		'fade-down': m.video_editor_text_motion_fade_down(),
		sink: m.video_editor_text_motion_sink(),
		'pop-out': m.video_editor_text_motion_pop_out(),
		'blur-out': m.video_editor_text_motion_blur_out(),
		'typewriter-erase': m.video_editor_text_motion_typewriter_erase(),
		pulse: m.video_editor_text_motion_pulse(),
		wave: m.video_editor_text_motion_wave(),
		shimmer: m.video_editor_text_motion_shimmer(),
		swing: m.video_editor_text_motion_swing()
	});
	const slotLabels = $derived<Record<TextMotionSlot, string>>({
		in: m.video_editor_text_motion_in(),
		out: m.video_editor_text_motion_out(),
		loop: m.video_editor_text_motion_loop()
	});
	const unitLabels = $derived<Record<TextMotionUnit, string>>({
		character: m.video_editor_text_motion_character(),
		word: m.video_editor_text_motion_word(),
		line: m.video_editor_text_motion_line(),
		'whole-clip': m.video_editor_text_motion_whole_clip()
	});
	const orderLabels = $derived<Record<TextMotionOrder, string>>({
		forward: m.video_editor_text_motion_forward(),
		backward: m.video_editor_text_motion_backward(),
		center: m.video_editor_text_motion_center(),
		random: m.video_editor_text_motion_random()
	});

	function activeEffect(slot: TextMotionSlot): TextMotionEffect | undefined {
		return firstSpec?.[slot];
	}
	function togglePreset(slot: TextMotionSlot, preset: TextMotionPreset): void {
		if (activeEffect(slot)?.presetId === preset.id)
			removeTextMotionFromItems(selectedTextIds, slot);
		else
			applyTextMotionToItems(
				selectedTextIds.map((id, index) => ({
					itemId: id,
					slot,
					effect: createTextMotionEffect(preset.id, index)
				}))
			);
		onedit();
	}
	function beginEdit(slot: TextMotionSlot): void {
		if (!editSnapshot) {
			editSnapshot = beginTextMotionEdit();
			editSlot = slot;
		}
	}
	function liveEdit(slot: TextMotionSlot, update: TextMotionEffectUpdate): void {
		beginEdit(slot);
		updateTextMotionLive(selectedTextIds, slot, update);
	}
	function commitEdit(slot: TextMotionSlot, update?: TextMotionEffectUpdate): void {
		const before = editSnapshot ?? beginTextMotionEdit();
		if (update) updateTextMotionLive(selectedTextIds, slot, update);
		commitTextMotionEdit(before, editSlot ?? slot, selectedTextIds);
		editSnapshot = null;
		editSlot = null;
		onedit();
	}
	function numberValue(event: Event): number {
		// SAFETY: numberValue is only bound to range inputs; currentTarget is that HTMLInputElement.
		return Number((event.currentTarget as HTMLInputElement).value);
	}
</script>

{#if selectedTextItems.length > 0}
	<section class="text-motion-panel" aria-labelledby="text-motion-title">
		<header>
			<div>
				<h2 id="text-motion-title">{m.video_editor_text_motion_title()}</h2>
				<p>{m.video_editor_text_motion_description()}</p>
			</div>
			<span>{m.video_editor_motion_selected({ count: String(selectedTextItems.length) })}</span>
		</header>
		{#each slots as slot}
			{@const effect = activeEffect(slot)}
			<div class="slot-row" data-slot={slot}>
				<h3>{slotLabels[slot]}</h3>
				<div class="preset-grid">
					{#each catalog[slot] as preset}
						{@const active = effect?.presetId === preset.id}
						<button
							type="button"
							class:active
							aria-pressed={active}
							aria-label={active
								? m.video_editor_text_motion_remove({ name: presetLabels[preset.id] })
								: presetLabels[preset.id]}
							onclick={() => togglePreset(slot, preset)}
							>{presetLabels[preset.id]}{active ? ' ×' : ''}</button
						>
					{/each}
				</div>
				{#if effect}
					<div class="controls">
						<label
							><span
								>{m.video_editor_text_motion_duration()}
								<output>{effect.durationFrames}f</output></span
							><Slider
								min={1}
								max={90}
								step={1}
								value={effect.durationFrames}
								ariaLabel={m.video_editor_text_motion_duration()}
								onValueChange={(value) => liveEdit(slot, { durationFrames: value })}
								onValueCommit={(value) => commitEdit(slot, { durationFrames: value })}
							/></label
						>
						<label
							><span
								>{m.video_editor_text_motion_stagger()}
								<output>{effect.staggerFrames}f</output></span
							><Slider
								min={0}
								max={30}
								step={1}
								value={effect.staggerFrames}
								ariaLabel={m.video_editor_text_motion_stagger()}
								onValueChange={(value) => liveEdit(slot, { staggerFrames: value })}
								onValueCommit={(value) => commitEdit(slot, { staggerFrames: value })}
							/></label
						>
						<label
							><span
								>{m.video_editor_text_motion_intensity()}
								<output>{Math.round(effect.intensity * 100)}%</output></span
							><Slider
								min={0}
								max={2}
								step={0.05}
								value={effect.intensity}
								ariaLabel={m.video_editor_text_motion_intensity()}
								onValueChange={(value) => liveEdit(slot, { intensity: value })}
								onValueCommit={(value) => commitEdit(slot, { intensity: value })}
							/></label
						>
						<div class="select-row">
							<label
								>{m.video_editor_text_motion_unit()}<AppSelect
									value={effect.unit ?? getTextMotionPreset(effect.presetId).unit}
									options={units.map((unit) => ({ value: unit, label: unitLabels[unit] }))}
									ariaLabel={m.video_editor_text_motion_unit()}
									onValueChange={(value) => commitEdit(slot, { unit: value as TextMotionUnit })}
									class="h-7 text-xs"
								/></label
							>
							<label
								>{m.video_editor_text_motion_order()}<AppSelect
									value={effect.order}
									options={orders.map((order) => ({ value: order, label: orderLabels[order] }))}
									ariaLabel={m.video_editor_text_motion_order()}
									onValueChange={(value) => commitEdit(slot, { order: value as TextMotionOrder })}
									class="h-7 text-xs"
								/></label
							>
						</div>
					</div>
				{/if}
			</div>
		{/each}
	</section>
{/if}

<style>
	.text-motion-panel {
		margin-top: 0.5rem;
		border-top: 1px solid oklch(0.25 0.015 55);
		padding-top: 0.75rem;
		color: oklch(0.92 0.012 70);
	}
	header {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		align-items: flex-start;
	}
	h2,
	h3,
	p {
		margin: 0;
	}
	h2 {
		font-size: 0.75rem;
		font-weight: 650;
	}
	header p {
		margin-top: 0.2rem;
		color: oklch(0.67 0.018 65);
		font-size: 0.625rem;
		line-height: 1.4;
	}
	header > span {
		flex: none;
		border: 1px solid oklch(0.31 0.02 58);
		border-radius: 999px;
		padding: 0.15rem 0.4rem;
		color: oklch(0.72 0.02 68);
		font-size: 0.5625rem;
	}
	.slot-row {
		margin-top: 0.75rem;
	}
	h3 {
		margin-bottom: 0.35rem;
		color: oklch(0.76 0.02 68);
		font-size: 0.625rem;
		font-weight: 650;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.preset-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.25rem;
	}
	.preset-grid button {
		min-height: 2rem;
		overflow: hidden;
		border: 1px solid oklch(0.29 0.018 58);
		border-radius: 0.35rem;
		padding: 0.25rem;
		background: oklch(0.17 0.012 55);
		color: oklch(0.7 0.018 65);
		font-size: 0.5625rem;
		line-height: 1.15;
		text-overflow: ellipsis;
		cursor: pointer;
	}
	.preset-grid button:hover {
		border-color: oklch(0.42 0.04 52);
		color: oklch(0.94 0.012 70);
	}
	.preset-grid button.active {
		border-color: oklch(0.62 0.14 45);
		background: oklch(0.27 0.06 45);
		color: oklch(0.96 0.02 70);
	}
	.controls {
		display: grid;
		gap: 0.55rem;
		margin-top: 0.4rem;
		border: 1px solid oklch(0.27 0.016 58);
		border-radius: 0.4rem;
		padding: 0.55rem;
		background: oklch(0.15 0.01 55);
	}
	.controls label {
		display: grid;
		gap: 0.2rem;
		color: oklch(0.7 0.018 65);
		font-size: 0.5625rem;
	}
	.controls label > span {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
	}
	output {
		color: oklch(0.9 0.02 70);
		font-variant-numeric: tabular-nums;
	}
	input[type='range'] {
		width: 100%;
		accent-color: oklch(0.66 0.14 45);
	}
	.select-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.4rem;
	}
	select {
		width: 100%;
		min-height: 1.75rem;
		border: 1px solid oklch(0.3 0.018 58);
		border-radius: 0.3rem;
		padding: 0 0.3rem;
		background: oklch(0.18 0.012 55);
		color: oklch(0.9 0.012 70);
		font: inherit;
	}
	button:focus-visible,
	input:focus-visible,
	select:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 2px;
	}
	@media (max-width: 24rem) {
		.preset-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
