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
		class="flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 px-2 text-xs focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)]"
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
				class="h-8 flex-1 text-xs"
				onValueChange={addEffect}
			/>
			{#if effects.length > 0}
				<Button type="button" size="sm" variant="ghost" class="h-8 px-2 text-xs" onclick={resetAll}
					>{m.video_editor_audio_effects_reset()}</Button
				>
			{/if}
		</div>

		{#if effects.length === 0}
			<p
				class="rounded bg-[var(--video-editor-control)] px-2 py-2 text-xs leading-4 text-[var(--video-editor-muted)]"
			>
				{m.video_editor_audio_effects_empty()}
			</p>
		{:else}
			<ul class="space-y-1" aria-label={m.video_editor_audio_effects_rack_aria()}>
				{#each effects as effect, index (effect.id)}
					<li
						class="rounded border border-[var(--video-editor-border)] bg-[var(--video-editor-canvas)]"
					>
						<details class="group/effect">
							<summary
								class="flex min-h-8 cursor-pointer list-none items-center gap-1.5 px-2 py-1 text-xs"
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
										class="h-6 px-1.5 text-xs"
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
										class="h-6 px-1.5 text-xs"
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
										<label class="text-xs text-[var(--video-editor-muted)]"
											>{m.video_editor_audio_effects_threshold()}
											<Input
												type="number"
												class="mt-0.5 h-7 text-xs"
												value={effect.thresholdDb}
												min={-60}
												max={0}
												step={1}
												onchange={(event) =>
													patchEffect(effect.id, 'compressor', {
														thresholdDb: event.currentTarget.valueAsNumber
													})}
											/>
										</label>
										<label class="text-xs text-[var(--video-editor-muted)]"
											>{m.video_editor_audio_effects_ratio()}
											<Input
												type="number"
												class="mt-0.5 h-7 text-xs"
												value={effect.ratio}
												min={1}
												max={20}
												step={0.5}
												onchange={(event) =>
													patchEffect(effect.id, 'compressor', {
														ratio: event.currentTarget.valueAsNumber
													})}
											/>
										</label>
										<label class="text-xs text-[var(--video-editor-muted)]"
											>{m.video_editor_audio_effects_attack()}
											<Input
												type="number"
												class="mt-0.5 h-7 text-xs"
												value={effect.attackMs}
												min={0.1}
												max={100}
												step={1}
												onchange={(event) =>
													patchEffect(effect.id, 'compressor', {
														attackMs: event.currentTarget.valueAsNumber
													})}
											/>
										</label>
										<label class="text-xs text-[var(--video-editor-muted)]"
											>{m.video_editor_audio_effects_makeup()}
											<Input
												type="number"
												class="mt-0.5 h-7 text-xs"
												value={effect.makeupGainDb}
												min={-12}
												max={12}
												step={0.5}
												onchange={(event) =>
													patchEffect(effect.id, 'compressor', {
														makeupGainDb: event.currentTarget.valueAsNumber
													})}
											/>
										</label>
									</div>
								{:else if effect.type === 'pan'}
									<label class="text-xs text-[var(--video-editor-muted)]"
										>{m.video_editor_audio_effects_pan_label()}
										<Slider
											class="mt-1 w-full"
											min={-1}
											max={1}
											step={0.05}
											value={effect.pan}
											ariaLabel={m.video_editor_audio_effects_pan_label()}
											onValueChange={(pan) => patchEffect(effect.id, 'pan', { pan })}
											onKeydown={(event) => event.stopPropagation()}
										/>
										<Input
											type="number"
											class="mt-1 h-7 text-xs"
											value={effect.pan}
											min={-1}
											max={1}
											step={0.05}
											onchange={(event) =>
												patchEffect(effect.id, 'pan', {
													pan: event.currentTarget.valueAsNumber
												})}
										/>
									</label>
								{:else if effect.type === 'reverb'}
									<div class="grid grid-cols-2 gap-1">
										<label class="text-xs text-[var(--video-editor-muted)]"
											>{m.video_editor_audio_effects_decay()}
											<Input
												type="number"
												class="mt-0.5 h-7 text-xs"
												value={effect.decaySeconds}
												min={0.1}
												max={6}
												step={0.1}
												onchange={(event) =>
													patchEffect(effect.id, 'reverb', {
														decaySeconds: event.currentTarget.valueAsNumber
													})}
											/>
										</label>
										<label class="text-xs text-[var(--video-editor-muted)]"
											>{m.video_editor_audio_effects_wet()}
											<Input
												type="number"
												class="mt-0.5 h-7 text-xs"
												value={effect.wet}
												min={0}
												max={1}
												step={0.05}
												onchange={(event) =>
													patchEffect(effect.id, 'reverb', {
														wet: event.currentTarget.valueAsNumber
													})}
											/>
										</label>
									</div>
								{:else if effect.type === 'delay'}
									<div class="grid grid-cols-2 gap-1">
										<label class="text-xs text-[var(--video-editor-muted)]"
											>{m.video_editor_audio_effects_time()}
											<Input
												type="number"
												class="mt-0.5 h-7 text-xs"
												value={effect.timeMs}
												min={1}
												max={2000}
												step={10}
												onchange={(event) =>
													patchEffect(effect.id, 'delay', {
														timeMs: event.currentTarget.valueAsNumber
													})}
											/>
										</label>
										<label class="text-xs text-[var(--video-editor-muted)]"
											>{m.video_editor_audio_effects_mix()}
											<Input
												type="number"
												class="mt-0.5 h-7 text-xs"
												value={effect.mix}
												min={0}
												max={1}
												step={0.05}
												onchange={(event) =>
													patchEffect(effect.id, 'delay', {
														mix: event.currentTarget.valueAsNumber
													})}
											/>
										</label>
										<label class="text-xs text-[var(--video-editor-muted)]"
											>{m.video_editor_audio_effects_feedback()}
											<Input
												type="number"
												class="mt-0.5 h-7 text-xs"
												value={effect.feedback}
												min={0}
												max={0.92}
												step={0.05}
												onchange={(event) =>
													patchEffect(effect.id, 'delay', {
														feedback: event.currentTarget.valueAsNumber
													})}
											/>
										</label>
									</div>
								{:else if effect.type === 'chorus'}
									<div class="grid grid-cols-2 gap-1">
										<label class="text-xs text-[var(--video-editor-muted)]"
											>{m.video_editor_audio_effects_rate()}
											<Input
												type="number"
												class="mt-0.5 h-7 text-xs"
												value={effect.rateHz}
												min={0.05}
												max={8}
												step={0.1}
												onchange={(event) =>
													patchEffect(effect.id, 'chorus', {
														rateHz: event.currentTarget.valueAsNumber
													})}
											/>
										</label>
										<label class="text-xs text-[var(--video-editor-muted)]"
											>{m.video_editor_audio_effects_depth()}
											<Input
												type="number"
												class="mt-0.5 h-7 text-xs"
												value={effect.depthMs}
												min={0.2}
												max={12}
												step={0.5}
												onchange={(event) =>
													patchEffect(effect.id, 'chorus', {
														depthMs: event.currentTarget.valueAsNumber
													})}
											/>
										</label>
									</div>
								{:else if effect.type === 'flanger'}
									<div class="grid grid-cols-2 gap-1">
										<label class="text-xs text-[var(--video-editor-muted)]"
											>{m.video_editor_audio_effects_rate()}
											<Input
												type="number"
												class="mt-0.5 h-7 text-xs"
												value={effect.rateHz}
												min={0.05}
												max={5}
												step={0.1}
												onchange={(event) =>
													patchEffect(effect.id, 'flanger', {
														rateHz: event.currentTarget.valueAsNumber
													})}
											/>
										</label>
										<label class="text-xs text-[var(--video-editor-muted)]"
											>{m.video_editor_audio_effects_depth()}
											<Input
												type="number"
												class="mt-0.5 h-7 text-xs"
												value={effect.depthMs}
												min={0.2}
												max={8}
												step={0.2}
												onchange={(event) =>
													patchEffect(effect.id, 'flanger', {
														depthMs: event.currentTarget.valueAsNumber
													})}
											/>
										</label>
									</div>
								{:else if effect.type === 'distortion'}
									<div class="grid grid-cols-2 gap-1">
										<label class="text-xs text-[var(--video-editor-muted)]"
											>{m.video_editor_audio_effects_amount()}
											<Input
												type="number"
												class="mt-0.5 h-7 text-xs"
												value={effect.amount}
												min={0}
												max={1}
												step={0.05}
												onchange={(event) =>
													patchEffect(effect.id, 'distortion', {
														amount: event.currentTarget.valueAsNumber
													})}
											/>
										</label>
										<label class="text-xs text-[var(--video-editor-muted)]"
											>{m.video_editor_audio_effects_mix()}
											<Input
												type="number"
												class="mt-0.5 h-7 text-xs"
												value={effect.mix}
												min={0}
												max={1}
												step={0.05}
												onchange={(event) =>
													patchEffect(effect.id, 'distortion', {
														mix: event.currentTarget.valueAsNumber
													})}
											/>
										</label>
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
