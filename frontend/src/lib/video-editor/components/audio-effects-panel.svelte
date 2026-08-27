<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import AppSelect, { type AppSelectOption } from '$lib/components/app-select.svelte';
	import { m } from '$lib/paraglide/messages';
	import type { TimelineItem } from '$lib/video-editor/project/types';
	import { updateItemProperties } from '$lib/video-editor/timeline/actions/items';
	import {
		AUDIO_EFFECT_TYPES,
		createDefaultAudioEffect,
		normalizeAudioEffects,
		reorderAudioEffects,
		type AudioEffect,
		type AudioEffectType
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
		if (!(AUDIO_EFFECT_TYPES as readonly string[]).includes(type)) return;
		const effect = createDefaultAudioEffect(type as AudioEffectType);
		commit([...effects, effect]);
	}

	function toggleEnabled(id: string): void {
		commit(effects.map((e) => (e.id === id ? { ...e, enabled: !e.enabled } : e)));
	}

	function removeEffect(id: string): void {
		commit(effects.filter((e) => e.id !== id));
	}

	function resetEffect(id: string): void {
		commit(
			effects.map((e) => {
				if (e.id !== id) return e;
				const def = createDefaultAudioEffect(e.type, e.id);
				return { ...def, id: e.id, enabled: e.enabled };
			})
		);
	}

	function resetAll(): void {
		commit([]);
	}

	function move(from: number, to: number): void {
		commit(reorderAudioEffects(effects, from, to));
	}

	function updateParam(id: string, patch: Partial<AudioEffect>): void {
		commit(effects.map((e) => (e.id === id ? normalizeAudioEffects([{ ...e, ...patch }])[0]! : e)));
	}

	const addOptions: AppSelectOption[] = [
		{ value: 'compressor', label: 'Compressor' },
		{ value: 'pan', label: 'Pan' },
		{ value: 'reverb', label: 'Reverb' },
		{ value: 'delay', label: 'Delay' },
		{ value: 'chorus', label: 'Chorus' },
		{ value: 'flanger', label: 'Flanger' },
		{ value: 'distortion', label: 'Distortion' }
	];

	function labelFor(type: AudioEffectType): string {
		return addOptions.find((o) => o.value === type)?.label ?? type;
	}
</script>

<details {open} class="group rounded-md border border-white/10 bg-black/10">
	<summary
		class="flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 px-2 text-xs focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
	>
		<span class="font-medium text-white/85">Audio effects</span>
		<span class="text-[10px] text-white/45">
			{effects.length === 0
				? 'None'
				: `${effects.length} · ${effects.filter((e) => e.enabled).length} on`}
		</span>
	</summary>
	<div class="space-y-2 border-t border-white/10 p-2">
		<div class="flex items-center gap-1">
			<AppSelect
				value=""
				options={[{ value: '', label: 'Add effect…' }, ...addOptions]}
				ariaLabel="Add audio effect"
				class="h-8 flex-1 text-xs"
				onValueChange={addEffect}
			/>
			{#if effects.length > 0}
				<Button
					type="button"
					size="sm"
					variant="ghost"
					class="h-8 px-2 text-[10px]"
					onclick={resetAll}>Reset</Button
				>
			{/if}
		</div>

		{#if effects.length === 0}
			<p class="rounded bg-white/[0.04] px-2 py-2 text-[11px] leading-4 text-white/55">
				Add compressor, pan, reverb, delay, chorus, flanger, or distortion. Effects run in order and
				apply to preview and export.
			</p>
		{:else}
			<ul class="space-y-1" aria-label="Audio effect rack">
				{#each effects as effect, index (effect.id)}
					<li class="rounded border border-white/8 bg-white/[0.02]">
						<details class="group/effect">
							<summary
								class="flex min-h-8 cursor-pointer list-none items-center gap-1.5 px-2 py-1 text-[11px]"
							>
								<span class="shrink-0 text-white/30" aria-hidden="true">≡</span>
								<span class="flex-1 truncate font-medium text-white/85"
									>{labelFor(effect.type)}</span
								>
								<button
									type="button"
									class={`rounded px-1.5 py-0.5 text-[9px] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] ${effect.enabled ? 'bg-[oklch(0.66_0.14_45)] text-black' : 'bg-white/10 text-white/70'}`}
									aria-pressed={effect.enabled}
									aria-label={`${effect.enabled ? 'Bypass' : 'Enable'} ${labelFor(effect.type)}`}
									onclick={(e) => {
										e.preventDefault();
										toggleEnabled(effect.id);
									}}>{effect.enabled ? 'On' : 'Off'}</button
								>
								<button
									type="button"
									class="rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-white/60 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
									aria-label={`Reset ${labelFor(effect.type)}`}
									onclick={(e) => {
										e.preventDefault();
										resetEffect(effect.id);
									}}>Reset</button
								>
								<button
									type="button"
									class="rounded px-1 py-0.5 text-[11px] text-white/40 hover:text-white/80 focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
									aria-label={`Remove ${labelFor(effect.type)}`}
									onclick={(e) => {
										e.preventDefault();
										removeEffect(effect.id);
									}}>×</button
								>
							</summary>
							<div class="border-t border-white/8 p-2">
								<div class="mb-2 flex gap-1">
									<Button
										type="button"
										size="sm"
										variant="ghost"
										class="h-6 px-1.5 text-[10px]"
										disabled={index === 0}
										onclick={() => move(index, index - 1)}>↑</Button
									>
									<Button
										type="button"
										size="sm"
										variant="ghost"
										class="h-6 px-1.5 text-[10px]"
										disabled={index === effects.length - 1}
										onclick={() => move(index, index + 1)}>↓</Button
									>
									<span class="ml-1 self-center text-[10px] text-white/35"
										>Order {index + 1} of {effects.length}</span
									>
								</div>

								{#if effect.type === 'compressor'}
									{@const c =
										effect as import('$lib/video-editor/audio/audio-effects').CompressorEffect}
									<div class="grid grid-cols-2 gap-1">
										<label class="text-[10px] text-white/60"
											>Threshold (dB)
											<Input
												type="number"
												class="mt-0.5 h-7 text-xs"
												value={c.thresholdDb}
												min={-60}
												max={0}
												step={1}
												onchange={(e) =>
													updateParam(effect.id, {
														thresholdDb: e.currentTarget.valueAsNumber
													} as never)}
											/>
										</label>
										<label class="text-[10px] text-white/60"
											>Ratio
											<Input
												type="number"
												class="mt-0.5 h-7 text-xs"
												value={c.ratio}
												min={1}
												max={20}
												step={0.5}
												onchange={(e) =>
													updateParam(effect.id, { ratio: e.currentTarget.valueAsNumber } as never)}
											/>
										</label>
										<label class="text-[10px] text-white/60"
											>Attack (ms)
											<Input
												type="number"
												class="mt-0.5 h-7 text-xs"
												value={c.attackMs}
												min={0.1}
												max={100}
												step={1}
												onchange={(e) =>
													updateParam(effect.id, {
														attackMs: e.currentTarget.valueAsNumber
													} as never)}
											/>
										</label>
										<label class="text-[10px] text-white/60"
											>Makeup (dB)
											<Input
												type="number"
												class="mt-0.5 h-7 text-xs"
												value={c.makeupGainDb}
												min={-12}
												max={12}
												step={0.5}
												onchange={(e) =>
													updateParam(effect.id, {
														makeupGainDb: e.currentTarget.valueAsNumber
													} as never)}
											/>
										</label>
									</div>
								{:else if effect.type === 'pan'}
									{@const p = effect as import('$lib/video-editor/audio/audio-effects').PanEffect}
									<label class="text-[10px] text-white/60"
										>Pan (-1 left, 1 right)
										<Input
											type="range"
											class="mt-1 h-2 w-full"
											min={-1}
											max={1}
											step={0.05}
											value={p.pan}
											oninput={(e) =>
												updateParam(effect.id, { pan: Number(e.currentTarget.value) } as never)}
										/>
										<Input
											type="number"
											class="mt-1 h-7 text-xs"
											value={p.pan}
											min={-1}
											max={1}
											step={0.05}
											onchange={(e) =>
												updateParam(effect.id, { pan: e.currentTarget.valueAsNumber } as never)}
										/>
									</label>
								{:else if effect.type === 'reverb'}
									{@const r =
										effect as import('$lib/video-editor/audio/audio-effects').ReverbEffect}
									<div class="grid grid-cols-2 gap-1">
										<label class="text-[10px] text-white/60"
											>Decay (s)
											<Input
												type="number"
												class="mt-0.5 h-7 text-xs"
												value={r.decaySeconds}
												min={0.1}
												max={6}
												step={0.1}
												onchange={(e) =>
													updateParam(effect.id, {
														decaySeconds: e.currentTarget.valueAsNumber
													} as never)}
											/>
										</label>
										<label class="text-[10px] text-white/60"
											>Wet
											<Input
												type="number"
												class="mt-0.5 h-7 text-xs"
												value={r.wet}
												min={0}
												max={1}
												step={0.05}
												onchange={(e) =>
													updateParam(effect.id, { wet: e.currentTarget.valueAsNumber } as never)}
											/>
										</label>
									</div>
								{:else if effect.type === 'delay'}
									{@const d = effect as import('$lib/video-editor/audio/audio-effects').DelayEffect}
									<div class="grid grid-cols-2 gap-1">
										<label class="text-[10px] text-white/60"
											>Time (ms)
											<Input
												type="number"
												class="mt-0.5 h-7 text-xs"
												value={d.timeMs}
												min={1}
												max={2000}
												step={10}
												onchange={(e) =>
													updateParam(effect.id, {
														timeMs: e.currentTarget.valueAsNumber
													} as never)}
											/>
										</label>
										<label class="text-[10px] text-white/60"
											>Mix
											<Input
												type="number"
												class="mt-0.5 h-7 text-xs"
												value={d.mix}
												min={0}
												max={1}
												step={0.05}
												onchange={(e) =>
													updateParam(effect.id, { mix: e.currentTarget.valueAsNumber } as never)}
											/>
										</label>
										<label class="text-[10px] text-white/60"
											>Feedback
											<Input
												type="number"
												class="mt-0.5 h-7 text-xs"
												value={d.feedback}
												min={0}
												max={0.92}
												step={0.05}
												onchange={(e) =>
													updateParam(effect.id, {
														feedback: e.currentTarget.valueAsNumber
													} as never)}
											/>
										</label>
									</div>
								{:else if effect.type === 'chorus'}
									{@const c =
										effect as import('$lib/video-editor/audio/audio-effects').ChorusEffect}
									<div class="grid grid-cols-2 gap-1">
										<label class="text-[10px] text-white/60"
											>Rate (Hz)
											<Input
												type="number"
												class="mt-0.5 h-7 text-xs"
												value={c.rateHz}
												min={0.05}
												max={8}
												step={0.1}
												onchange={(e) =>
													updateParam(effect.id, {
														rateHz: e.currentTarget.valueAsNumber
													} as never)}
											/>
										</label>
										<label class="text-[10px] text-white/60"
											>Depth (ms)
											<Input
												type="number"
												class="mt-0.5 h-7 text-xs"
												value={c.depthMs}
												min={0.2}
												max={12}
												step={0.5}
												onchange={(e) =>
													updateParam(effect.id, {
														depthMs: e.currentTarget.valueAsNumber
													} as never)}
											/>
										</label>
									</div>
								{:else if effect.type === 'flanger'}
									{@const f =
										effect as import('$lib/video-editor/audio/audio-effects').FlangerEffect}
									<div class="grid grid-cols-2 gap-1">
										<label class="text-[10px] text-white/60"
											>Rate (Hz)
											<Input
												type="number"
												class="mt-0.5 h-7 text-xs"
												value={f.rateHz}
												min={0.05}
												max={5}
												step={0.1}
												onchange={(e) =>
													updateParam(effect.id, {
														rateHz: e.currentTarget.valueAsNumber
													} as never)}
											/>
										</label>
										<label class="text-[10px] text-white/60"
											>Depth (ms)
											<Input
												type="number"
												class="mt-0.5 h-7 text-xs"
												value={f.depthMs}
												min={0.2}
												max={8}
												step={0.2}
												onchange={(e) =>
													updateParam(effect.id, {
														depthMs: e.currentTarget.valueAsNumber
													} as never)}
											/>
										</label>
									</div>
								{:else if effect.type === 'distortion'}
									{@const ds =
										effect as import('$lib/video-editor/audio/audio-effects').DistortionEffect}
									<div class="grid grid-cols-2 gap-1">
										<label class="text-[10px] text-white/60"
											>Amount
											<Input
												type="number"
												class="mt-0.5 h-7 text-xs"
												value={ds.amount}
												min={0}
												max={1}
												step={0.05}
												onchange={(e) =>
													updateParam(effect.id, {
														amount: e.currentTarget.valueAsNumber
													} as never)}
											/>
										</label>
										<label class="text-[10px] text-white/60"
											>Mix
											<Input
												type="number"
												class="mt-0.5 h-7 text-xs"
												value={ds.mix}
												min={0}
												max={1}
												step={0.05}
												onchange={(e) =>
													updateParam(effect.id, { mix: e.currentTarget.valueAsNumber } as never)}
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
