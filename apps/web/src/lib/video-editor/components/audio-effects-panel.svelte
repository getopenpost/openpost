<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Slider } from '$lib/components/ui/slider';
	import AppSelect, { type AppSelectOption } from '$lib/components/app-select.svelte';
	import { m } from '$lib/paraglide/messages';
	import type { TimelineItem } from '$lib/video-editor/project/types';
	import { updateItemProperties } from '$lib/video-editor/timeline/actions/items';
	import {
		createDefaultAudioEffect,
		isAudioEffectType,
		normalizeAudioEffects,
		reorderAudioEffects,
		type AudioEffect,
		type AudioEffectType,
		type ChorusEffect,
		type CompressorEffect,
		type DelayEffect,
		type DistortionEffect,
		type FlangerEffect,
		type PanEffect,
		type ReverbEffect
	} from '$lib/video-editor/audio/audio-effects';

	let {
		item,
		open = false
	}: {
		item: TimelineItem;
		open?: boolean;
	} = $props();

	const effects = $derived(normalizeAudioEffects(item.audioEffects));

	function commit(next: AudioEffect[]): void {
		updateItemProperties(
			item.id,
			next.length > 0 ? { audioEffects: next } : { audioEffects: undefined },
			'UPDATE_CLIP_AUDIO_EFFECTS'
		);
	}

	function addEffect(type: string): void {
		if (!isAudioEffectType(type)) return;
		const effect = createDefaultAudioEffect(type);
		commit([...effects, effect]);
	}

	function toggleEnabled(id: string): void {
		commit(
			effects.map((effect) => (effect.id === id ? { ...effect, enabled: !effect.enabled } : effect))
		);
	}

	function removeEffect(id: string): void {
		commit(effects.filter((effect) => effect.id !== id));
	}

	function resetEffect(id: string): void {
		commit(
			effects.map((effect) => {
				if (effect.id !== id) return effect;
				const def = createDefaultAudioEffect(effect.type, effect.id);
				return { ...def, id: effect.id, enabled: effect.enabled };
			})
		);
	}

	function resetAll(): void {
		commit([]);
	}

	function move(from: number, to: number): void {
		commit(reorderAudioEffects(effects, from, to));
	}

	type EffectPatchMap = {
		compressor: Partial<CompressorEffect>;
		pan: Partial<PanEffect>;
		reverb: Partial<ReverbEffect>;
		delay: Partial<DelayEffect>;
		chorus: Partial<ChorusEffect>;
		flanger: Partial<FlangerEffect>;
		distortion: Partial<DistortionEffect>;
	};

	function patchEffect<K extends AudioEffectType>(
		id: string,
		type: K,
		patch: EffectPatchMap[K]
	): void {
		commit(
			effects.map((effect) => {
				if (effect.id !== id || effect.type !== type) return effect;
				const merged = { ...effect, ...patch };
				const normalized = normalizeAudioEffects([merged]);
				return normalized[0] ?? effect;
			})
		);
	}

	const addOptions: AppSelectOption[] = [
		{ value: 'compressor', label: m.video_editor_audio_effects_compressor() },
		{ value: 'pan', label: m.video_editor_audio_effects_pan() },
		{ value: 'reverb', label: m.video_editor_audio_effects_reverb() },
		{ value: 'delay', label: m.video_editor_audio_effects_delay() },
		{ value: 'chorus', label: m.video_editor_audio_effects_chorus() },
		{ value: 'flanger', label: m.video_editor_audio_effects_flanger() },
		{ value: 'distortion', label: m.video_editor_audio_effects_distortion() }
	];

	function labelFor(type: AudioEffectType): string {
		return addOptions.find((option) => option.value === type)?.label ?? type;
	}
</script>

<details
	{open}
	class="group rounded-md border border-[var(--video-editor-border)] bg-[var(--video-editor-panel)]"
>
	<summary
		class="flex min-h-[25px] cursor-pointer list-none items-center justify-between gap-2 px-2 text-xs focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)]"
	>
		<span class="font-medium text-[var(--video-editor-text)]"
			>{m.video_editor_audio_effects_title()}</span
		>
		<span class="text-xs text-[var(--video-editor-muted)]">
			{#if effects.length === 0}
				{m.common_none()}
			{:else}
				{m.video_editor_audio_effects_count({
					count: effects.length,
					enabled: effects.filter((effect) => effect.enabled).length
				})}
			{/if}
		</span>
	</summary>
	<div class="space-y-2 border-t border-[var(--video-editor-border)] p-2">
		<div class="flex items-center gap-1">
			<AppSelect
				value=""
				options={[
					{ value: '', label: m.video_editor_audio_effects_add_placeholder() },
					...addOptions
				]}
				ariaLabel={m.video_editor_audio_effects_add_aria()}
				class="h-[25px] flex-1 text-xs"
				onValueChange={addEffect}
			/>
			{#if effects.length > 0}
				<Button
					type="button"
					size="sm"
					variant="ghost"
					class="h-[25px] px-2 text-xs"
					onclick={resetAll}>{m.video_editor_audio_effects_reset()}</Button
				>
			{/if}
		</div>

		{#if effects.length === 0}
			<p
				class="truncate rounded bg-[var(--video-editor-control)] px-2 py-1 text-[11px] text-[var(--video-editor-muted)]"
				title={m.video_editor_audio_effects_empty()}
			>
				{m.video_editor_audio_effects_empty()}
			</p>
		{:else}
			{#snippet effectNumberParam(
				label: string,
				value: number,
				min: number,
				max: number,
				step: number,
				onNumber: (value: number) => void
			)}
				<label class="text-xs text-[var(--video-editor-muted)]">
					{label}
					<Input
						type="number"
						class="mt-0.5 h-[22px] text-xs"
						{value}
						{min}
						{max}
						{step}
						onchange={(event) => onNumber(event.currentTarget.valueAsNumber)}
					/>
				</label>
			{/snippet}

			<ul class="space-y-1" aria-label={m.video_editor_audio_effects_rack_aria()}>
				{#each effects as effect, index (effect.id)}
					<li
						class="rounded border border-[var(--video-editor-border)] bg-[var(--video-editor-canvas)]"
					>
						<details class="group/effect">
							<summary
								class="flex min-h-[25px] cursor-pointer list-none items-center gap-1.5 px-2 py-1 text-xs"
							>
								<span class="shrink-0 text-[var(--video-editor-muted)]" aria-hidden="true">≡</span>
								<span class="flex-1 truncate font-medium text-[var(--video-editor-text)]"
									>{labelFor(effect.type)}</span
								>
								<button
									type="button"
									class={`rounded px-1.5 py-0.5 text-xs focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)] ${effect.enabled ? 'bg-primary text-primary-foreground' : 'bg-[var(--video-editor-control)] text-[var(--video-editor-muted)]'}`}
									aria-pressed={effect.enabled}
									aria-label={effect.enabled
										? m.video_editor_audio_effects_bypass({ name: labelFor(effect.type) })
										: m.video_editor_audio_effects_enable({ name: labelFor(effect.type) })}
									onclick={(event) => {
										event.preventDefault();
										toggleEnabled(effect.id);
									}}
									>{effect.enabled
										? m.video_editor_audio_eq_on()
										: m.video_editor_audio_eq_off()}</button
								>
								<button
									type="button"
									class="rounded bg-[var(--video-editor-control)] px-1.5 py-0.5 text-xs text-[var(--video-editor-muted)] hover:bg-[var(--video-editor-control-hover)] focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)]"
									aria-label={m.video_editor_audio_effects_reset_effect({
										name: labelFor(effect.type)
									})}
									onclick={(event) => {
										event.preventDefault();
										resetEffect(effect.id);
									}}>{m.video_editor_audio_effects_reset()}</button
								>
								<button
									type="button"
									class="rounded px-1 py-0.5 text-xs text-[var(--video-editor-muted)] hover:text-[var(--video-editor-text)] focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)]"
									aria-label={m.video_editor_audio_effects_remove_effect({
										name: labelFor(effect.type)
									})}
									onclick={(event) => {
										event.preventDefault();
										removeEffect(effect.id);
									}}>×</button
								>
							</summary>
							<div class="border-t border-[var(--video-editor-border)] p-2">
								<div class="mb-2 flex gap-1">
									<Button
										type="button"
										size="sm"
										variant="ghost"
										class="h-[22px] px-1.5 text-xs"
										disabled={index === 0}
										aria-label={m.video_editor_audio_effects_move_up({
											name: labelFor(effect.type)
										})}
										onclick={() => move(index, index - 1)}>↑</Button
									>
									<Button
										type="button"
										size="sm"
										variant="ghost"
										class="h-[22px] px-1.5 text-xs"
										disabled={index === effects.length - 1}
										aria-label={m.video_editor_audio_effects_move_down({
											name: labelFor(effect.type)
										})}
										onclick={() => move(index, index + 1)}>↓</Button
									>
									<span class="ml-1 self-center text-xs text-[var(--video-editor-muted)]"
										>{m.video_editor_audio_effects_order({
											position: index + 1,
											total: effects.length
										})}</span
									>
								</div>

								{#if effect.type === 'compressor'}
									<div class="grid grid-cols-2 gap-1">
										{@render effectNumberParam(
											m.video_editor_audio_effects_threshold(),
											effect.thresholdDb,
											-60,
											0,
											1,
											(v) => patchEffect(effect.id, 'compressor', { thresholdDb: v })
										)}
										{@render effectNumberParam(
											m.video_editor_audio_effects_ratio(),
											effect.ratio,
											1,
											20,
											0.5,
											(v) => patchEffect(effect.id, 'compressor', { ratio: v })
										)}
										{@render effectNumberParam(
											m.video_editor_audio_effects_attack(),
											effect.attackMs,
											0.1,
											100,
											1,
											(v) => patchEffect(effect.id, 'compressor', { attackMs: v })
										)}
										{@render effectNumberParam(
											m.video_editor_audio_effects_makeup(),
											effect.makeupGainDb,
											-12,
											12,
											0.5,
											(v) => patchEffect(effect.id, 'compressor', { makeupGainDb: v })
										)}
									</div>
								{:else if effect.type === 'pan'}
									{@render effectNumberParam(
										m.video_editor_audio_effects_pan_label(),
										effect.pan,
										-1,
										1,
										0.05,
										(v) => patchEffect(effect.id, 'pan', { pan: v })
									)}
								{:else if effect.type === 'reverb'}
									<div class="grid grid-cols-2 gap-1">
										{@render effectNumberParam(
											m.video_editor_audio_effects_decay(),
											effect.decaySeconds,
											0.1,
											6,
											0.1,
											(v) => patchEffect(effect.id, 'reverb', { decaySeconds: v })
										)}
										{@render effectNumberParam(
											m.video_editor_audio_effects_wet(),
											effect.wet,
											0,
											1,
											0.05,
											(v) => patchEffect(effect.id, 'reverb', { wet: v })
										)}
									</div>
								{:else if effect.type === 'delay'}
									<div class="grid grid-cols-2 gap-1">
										{@render effectNumberParam(
											m.video_editor_audio_effects_time(),
											effect.timeMs,
											1,
											2000,
											10,
											(v) => patchEffect(effect.id, 'delay', { timeMs: v })
										)}
										{@render effectNumberParam(
											m.video_editor_audio_effects_mix(),
											effect.mix,
											0,
											1,
											0.05,
											(v) => patchEffect(effect.id, 'delay', { mix: v })
										)}
										{@render effectNumberParam(
											m.video_editor_audio_effects_feedback(),
											effect.feedback,
											0,
											0.92,
											0.05,
											(v) => patchEffect(effect.id, 'delay', { feedback: v })
										)}
									</div>
								{:else if effect.type === 'chorus'}
									<div class="grid grid-cols-2 gap-1">
										{@render effectNumberParam(
											m.video_editor_audio_effects_rate(),
											effect.rateHz,
											0.05,
											8,
											0.1,
											(v) => patchEffect(effect.id, 'chorus', { rateHz: v })
										)}
										{@render effectNumberParam(
											m.video_editor_audio_effects_depth(),
											effect.depthMs,
											0.2,
											12,
											0.5,
											(v) => patchEffect(effect.id, 'chorus', { depthMs: v })
										)}
									</div>
								{:else if effect.type === 'flanger'}
									<div class="grid grid-cols-2 gap-1">
										{@render effectNumberParam(
											m.video_editor_audio_effects_rate(),
											effect.rateHz,
											0.05,
											5,
											0.1,
											(v) => patchEffect(effect.id, 'flanger', { rateHz: v })
										)}
										{@render effectNumberParam(
											m.video_editor_audio_effects_depth(),
											effect.depthMs,
											0.2,
											8,
											0.2,
											(v) => patchEffect(effect.id, 'flanger', { depthMs: v })
										)}
									</div>
								{:else if effect.type === 'distortion'}
									<div class="grid grid-cols-2 gap-1">
										{@render effectNumberParam(
											m.video_editor_audio_effects_amount(),
											effect.amount,
											0,
											1,
											0.05,
											(v) => patchEffect(effect.id, 'distortion', { amount: v })
										)}
										{@render effectNumberParam(
											m.video_editor_audio_effects_mix(),
											effect.mix,
											0,
											1,
											0.05,
											(v) => patchEffect(effect.id, 'distortion', { mix: v })
										)}
									</div>
								{/if}
							</div>
						</details>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</details>
