<script lang="ts">
	/* oxlint-disable anti-slop/no-known-value-widening, anti-slop/no-unknown-parameters, anti-slop/require-safety-comment-for-type-assertion -- The six typed band definitions map resolved EQ keys to flat persisted timeline keys. */
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';
	import AppSelect, { type AppSelectOption } from '$lib/components/app-select.svelte';
	import type { TimelineItem } from '$lib/video-editor/project/types';
	import { updateItemProperties } from '$lib/video-editor/timeline/actions/items';
	import {
		commandHistory,
		executeAtomic
	} from '$lib/video-editor/timeline/commands/command-store.svelte';
	import {
		captureSnapshot,
		restoreSnapshot
	} from '$lib/video-editor/timeline/commands/snapshot.svelte';
	import type { TimelineSnapshot } from '$lib/video-editor/timeline/commands/types';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import {
		AUDIO_EQ_GAIN_DB_MAX,
		AUDIO_EQ_GAIN_DB_MIN,
		AUDIO_EQ_PRESETS,
		AUDIO_EQ_Q_MAX,
		AUDIO_EQ_Q_MIN,
		areAudioEqStagesEqual,
		findAudioEqPresetId,
		getAudioEqPresetById,
		resolveAudioEqSettings,
		type AudioEqPresetId
	} from '$lib/video-editor/audio/audio-eq';
	import {
		AUDIO_EQ_BAND1_FILTER_OPTIONS,
		AUDIO_EQ_BAND6_FILTER_OPTIONS,
		AUDIO_EQ_INNER_FILTER_OPTIONS,
		AUDIO_EQ_SLOPE_OPTIONS,
		buildTimelineEqPatchFromSettings
	} from '$lib/video-editor/audio/audio-eq-ui';
	import type { AudioEqSettings, ResolvedAudioEqSettings } from '$lib/video-editor/audio/types';
	import AudioEqCurveEditor from './audio-eq-curve-editor.svelte';

	let {
		item,
		items = [],
		settings = {},
		onsettingschange,
		onedit = () => {},
		title,
		open = false
	}: {
		item?: TimelineItem;
		items?: TimelineItem[];
		settings?: AudioEqSettings;
		onsettingschange?: (settings: AudioEqSettings) => void;
		onedit?: () => void;
		title?: string;
		open?: boolean;
	} = $props();

	interface BandDefinition {
		key: 'band1' | 'low' | 'lowMid' | 'highMid' | 'high' | 'band6';
		label: () => string;
		enabledField: keyof AudioEqSettings;
		typeField: keyof AudioEqSettings;
		frequencyField: keyof AudioEqSettings;
		gainField: keyof AudioEqSettings;
		qField: keyof AudioEqSettings;
		slopeField?: keyof AudioEqSettings;
		enabledKey: keyof ResolvedAudioEqSettings;
		typeKey: keyof ResolvedAudioEqSettings;
		frequencyKey: keyof ResolvedAudioEqSettings;
		gainKey: keyof ResolvedAudioEqSettings;
		qKey: keyof ResolvedAudioEqSettings;
		slopeKey?: keyof ResolvedAudioEqSettings;
		types: readonly string[];
	}

	const bands: BandDefinition[] = [
		{
			key: 'band1',
			label: m.video_editor_audio_eq_band_1,
			enabledField: 'band1Enabled',
			typeField: 'band1Type',
			frequencyField: 'band1FrequencyHz',
			gainField: 'band1GainDb',
			qField: 'band1Q',
			slopeField: 'band1SlopeDbPerOct',
			enabledKey: 'band1Enabled',
			typeKey: 'band1Type',
			frequencyKey: 'band1FrequencyHz',
			gainKey: 'band1GainDb',
			qKey: 'band1Q',
			slopeKey: 'band1SlopeDbPerOct',
			types: AUDIO_EQ_BAND1_FILTER_OPTIONS
		},
		{
			key: 'low',
			label: m.video_editor_audio_eq_low,
			enabledField: 'lowEnabled',
			typeField: 'lowType',
			frequencyField: 'lowFrequencyHz',
			gainField: 'lowGainDb',
			qField: 'lowQ',
			enabledKey: 'lowEnabled',
			typeKey: 'lowType',
			frequencyKey: 'lowFrequencyHz',
			gainKey: 'lowGainDb',
			qKey: 'lowQ',
			types: AUDIO_EQ_INNER_FILTER_OPTIONS
		},
		{
			key: 'lowMid',
			label: m.video_editor_audio_eq_low_mid,
			enabledField: 'lowMidEnabled',
			typeField: 'lowMidType',
			frequencyField: 'lowMidFrequencyHz',
			gainField: 'lowMidGainDb',
			qField: 'lowMidQ',
			enabledKey: 'lowMidEnabled',
			typeKey: 'lowMidType',
			frequencyKey: 'lowMidFrequencyHz',
			gainKey: 'lowMidGainDb',
			qKey: 'lowMidQ',
			types: AUDIO_EQ_INNER_FILTER_OPTIONS
		},
		{
			key: 'highMid',
			label: m.video_editor_audio_eq_high_mid,
			enabledField: 'highMidEnabled',
			typeField: 'highMidType',
			frequencyField: 'highMidFrequencyHz',
			gainField: 'highMidGainDb',
			qField: 'highMidQ',
			enabledKey: 'highMidEnabled',
			typeKey: 'highMidType',
			frequencyKey: 'highMidFrequencyHz',
			gainKey: 'highMidGainDb',
			qKey: 'highMidQ',
			types: AUDIO_EQ_INNER_FILTER_OPTIONS
		},
		{
			key: 'high',
			label: m.video_editor_audio_eq_high,
			enabledField: 'highEnabled',
			typeField: 'highType',
			frequencyField: 'highFrequencyHz',
			gainField: 'highGainDb',
			qField: 'highQ',
			enabledKey: 'highEnabled',
			typeKey: 'highType',
			frequencyKey: 'highFrequencyHz',
			gainKey: 'highGainDb',
			qKey: 'highQ',
			types: AUDIO_EQ_INNER_FILTER_OPTIONS
		},
		{
			key: 'band6',
			label: m.video_editor_audio_eq_band_6,
			enabledField: 'band6Enabled',
			typeField: 'band6Type',
			frequencyField: 'band6FrequencyHz',
			gainField: 'band6GainDb',
			qField: 'band6Q',
			slopeField: 'band6SlopeDbPerOct',
			enabledKey: 'band6Enabled',
			typeKey: 'band6Type',
			frequencyKey: 'band6FrequencyHz',
			gainKey: 'band6GainDb',
			qKey: 'band6Q',
			slopeKey: 'band6SlopeDbPerOct',
			types: AUDIO_EQ_BAND6_FILTER_OPTIONS
		}
	];

	function typeLabel(type: string): string {
		if (type === 'high-pass') return m.video_editor_audio_eq_high_pass();
		if (type === 'low-pass') return m.video_editor_audio_eq_low_pass();
		if (type === 'low-shelf') return m.video_editor_audio_eq_low_shelf();
		if (type === 'high-shelf') return m.video_editor_audio_eq_high_shelf();
		if (type === 'peaking') return m.video_editor_audio_eq_peaking();
		if (type === 'notch') return m.video_editor_audio_eq_notch();
		return type;
	}

	function presetLabel(id: AudioEqPresetId | 'custom'): string {
		switch (id) {
			case 'flat':
				return m.video_editor_audio_eq_preset_flat();
			case 'voice-clarity':
				return m.video_editor_audio_eq_preset_voice_clarity();
			case 'podcast':
				return m.video_editor_audio_eq_preset_podcast();
			case 'warmth':
				return m.video_editor_audio_eq_preset_warmth();
			case 'bass-boost':
				return m.video_editor_audio_eq_preset_bass_boost();
			case 'de-mud':
				return m.video_editor_audio_eq_preset_de_mud();
			case 'smile':
				return m.video_editor_audio_eq_preset_smile();
			case 'sparkle':
				return m.video_editor_audio_eq_preset_sparkle();
			case 'air':
				return m.video_editor_audio_eq_preset_air();
			case 'soften':
				return m.video_editor_audio_eq_preset_soften();
			case 'radio':
				return m.video_editor_audio_eq_preset_radio();
			case 'telephone':
				return m.video_editor_audio_eq_preset_telephone();
			case 'dialog-lift':
				return m.video_editor_audio_eq_preset_dialog_lift();
			case 'rumble-cut':
				return m.video_editor_audio_eq_preset_rumble_cut();
			case 'brighten':
				return m.video_editor_audio_eq_preset_brighten();
			case 'custom':
				return m.video_editor_audio_eq_custom();
		}
	}
	const presetOptions: AppSelectOption[] = [
		{ value: 'mixed', label: m.video_editor_property_mixed(), disabled: true },
		{ value: 'custom', label: presetLabel('custom') },
		...AUDIO_EQ_PRESETS.map((preset) => ({
			value: preset.id,
			label: presetLabel(preset.id)
		}))
	];
	const slopeOptions: AppSelectOption[] = AUDIO_EQ_SLOPE_OPTIONS.map((slope) => ({
		value: String(slope),
		label: `${slope} dB/oct`
	}));

	const clipItems = $derived.by(() => {
		const candidates = items.length > 0 ? items : item ? [item] : [];
		return [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()];
	});
	const resolvedItems = $derived(clipItems.map((candidate) => resolveAudioEqSettings(candidate)));
	const resolved = $derived(resolvedItems[0] ?? resolveAudioEqSettings(settings));
	const mixedSettings = $derived(
		resolvedItems.length > 1 &&
			resolvedItems.slice(1).some((candidate) => !areAudioEqStagesEqual([resolved], [candidate]))
	);
	const enabledState = $derived.by<'on' | 'off' | 'mixed'>(() => {
		if (clipItems.length === 0) return settings.enabled === false ? 'off' : 'on';
		const states = clipItems.map((candidate) => candidate.audioEqEnabled !== false);
		return states.every(Boolean) ? 'on' : states.every((state) => !state) ? 'off' : 'mixed';
	});
	const bypassed = $derived(enabledState === 'off');
	const controlsDisabled = $derived(mixedSettings || enabledState !== 'on');
	const selectedPreset = $derived(
		mixedSettings ? 'mixed' : (findAudioEqPresetId(resolved) ?? 'custom')
	);
	let curveGesture = $state<{ before: TimelineSnapshot; changed: boolean } | null>(null);

	function commit(patch: Partial<AudioEqSettings>): void {
		if (clipItems.length > 0) {
			const timelinePatch = buildTimelineEqPatchFromSettings(patch);
			executeAtomic('UPDATE_CLIP_AUDIO_EQ', () => {
				for (const candidate of clipItems) {
					updateItemProperties(candidate.id, timelinePatch, 'UPDATE_CLIP_AUDIO_EQ');
				}
			});
		} else {
			const enabled = patch.enabled ?? settings.enabled;
			const next = resolveAudioEqSettings({ ...settings, ...patch });
			onsettingschange?.({ enabled, ...next });
		}
		onedit();
	}

	function beginCurveGesture(): void {
		if (clipItems.length === 0 || curveGesture) return;
		curveGesture = { before: captureSnapshot(), changed: false };
	}

	function writeCurveLive(patch: Partial<AudioEqSettings>): void {
		if (clipItems.length === 0) {
			const enabled = patch.enabled ?? settings.enabled;
			onsettingschange?.({ enabled, ...resolveAudioEqSettings({ ...settings, ...patch }) });
			return;
		}
		const timelinePatch = buildTimelineEqPatchFromSettings(patch);
		const updates = clipItems.map((candidate) => ({ id: candidate.id, patch: timelinePatch }));
		timelineStore._updateItems(updates);
		if (curveGesture) curveGesture.changed = true;
	}

	function commitCurveGesture(patch: Partial<AudioEqSettings>): void {
		if (clipItems.length === 0) {
			writeCurveLive(patch);
			onedit();
			return;
		}
		if (!curveGesture) {
			commit(patch);
			return;
		}
		const current = curveGesture;
		curveGesture = null;
		if (!current.changed) return;
		commandHistory.addUndoEntry(
			{
				type: 'UPDATE_CLIP_AUDIO_EQ_CURVE',
				payload: { ids: clipItems.map((candidate) => candidate.id) }
			},
			current.before
		);
		onedit();
	}

	function cancelCurveGesture(): void {
		if (!curveGesture) return;
		restoreSnapshot(curveGesture.before);
		curveGesture = null;
	}

	function setField(field: keyof AudioEqSettings, value: unknown): void {
		commit({ [field]: value } as Partial<AudioEqSettings>);
	}

	function applyPreset(id: string): void {
		if (id === 'custom') return;
		const preset = getAudioEqPresetById(id as AudioEqPresetId);
		if (!preset) return;
		commit({ enabled: true, ...preset.settings });
	}

	function enabled(band: BandDefinition): boolean {
		return Boolean(resolved[band.enabledKey]);
	}

	function value(
		band: BandDefinition,
		key: 'typeKey' | 'frequencyKey' | 'gainKey' | 'qKey' | 'slopeKey'
	) {
		const resolvedKey = band[key];
		return resolvedKey ? resolved[resolvedKey] : undefined;
	}

	function isPass(type: unknown): boolean {
		return type === 'high-pass' || type === 'low-pass';
	}
</script>

<details {open} class="group rounded-md border border-white/10 bg-black/10">
	<summary
		class="flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 px-2 text-xs focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
	>
		<span class="font-medium text-white/85">{title ?? m.video_editor_audio_eq_title()}</span>
		<span class="text-xs text-white/45"
			>{mixedSettings || enabledState === 'mixed'
				? m.video_editor_property_mixed()
				: bypassed
					? m.video_editor_audio_eq_bypassed()
					: selectedPreset === 'custom'
						? m.video_editor_audio_eq_custom()
						: presetOptions.find((option) => option.value === selectedPreset)?.label}</span
		>
	</summary>
	<div class="space-y-2 border-t border-white/10 p-2">
		<div class="flex items-end gap-1">
			<label class="min-w-0 flex-1 text-xs text-white/60">
				{m.video_editor_audio_eq_preset()}
				<AppSelect
					value={selectedPreset}
					options={presetOptions}
					ariaLabel={m.video_editor_audio_eq_preset_aria()}
					class="mt-0.5 h-8 w-full text-xs"
					onValueChange={applyPreset}
				/>
			</label>
			<Button
				type="button"
				size="sm"
				variant={enabledState === 'on' ? 'secondary' : 'outline'}
				class="h-8 px-2 text-xs"
				aria-pressed={enabledState === 'on'}
				onclick={() => commit({ enabled: enabledState !== 'on' })}
			>
				{enabledState === 'on'
					? m.video_editor_audio_eq_bypass()
					: m.video_editor_audio_eq_enable()}
			</Button>
		</div>

		<AudioEqCurveEditor
			settings={resolved}
			disabled={controlsDisabled}
			onbegin={beginCurveGesture}
			onlive={writeCurveLive}
			oncommit={commitCurveGesture}
			oncancel={cancelCurveGesture}
		/>

		<label class="block text-xs text-white/60">
			{m.video_editor_audio_eq_output_gain()}
			<Input
				class="mt-0.5 h-8 w-full bg-[oklch(0.22_0.01_50)] text-xs"
				type="number"
				min={AUDIO_EQ_GAIN_DB_MIN}
				max={AUDIO_EQ_GAIN_DB_MAX}
				step="0.1"
				value={resolved.outputGainDb}
				disabled={controlsDisabled}
				onchange={(event) => commit({ outputGainDb: event.currentTarget.valueAsNumber })}
			/>
		</label>

		<div class="space-y-1">
			{#each bands as band (band.key)}
				{@const bandType = value(band, 'typeKey')}
				<details class="rounded border border-white/8 bg-white/[0.02]">
					<summary class="flex min-h-8 cursor-pointer list-none items-center gap-2 px-2 text-xs">
						<span class="w-14 font-medium text-white/75">{band.label()}</span>
						<span class="min-w-0 flex-1 truncate text-white/45"
							>{typeLabel(String(bandType))} · {Math.round(Number(value(band, 'frequencyKey')))} Hz</span
						>
						<button
							type="button"
							class={`rounded px-1.5 py-0.5 text-xs focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] ${enabled(band) ? 'bg-[oklch(0.66_0.14_45)] text-black' : 'bg-white/8'}`}
							aria-pressed={enabled(band)}
							disabled={controlsDisabled}
							onclick={(event) => {
								event.preventDefault();
								setField(band.enabledField, !enabled(band));
							}}
							>{enabled(band)
								? m.video_editor_audio_eq_on()
								: m.video_editor_audio_eq_off()}</button
						>
					</summary>
					<div class="grid grid-cols-2 gap-1 border-t border-white/8 p-2">
						<label class="text-xs text-white/60">
							{m.video_editor_audio_eq_filter()}
							<AppSelect
								value={String(bandType)}
								options={band.types.map((type) => ({
									value: type,
									label: typeLabel(type)
								}))}
								ariaLabel={m.video_editor_audio_eq_filter_aria({ band: band.label() })}
								disabled={controlsDisabled}
								class="mt-0.5 h-8 w-full text-xs"
								onValueChange={(next) => setField(band.typeField, next)}
							/>
						</label>
						<label class="text-xs text-white/60">
							{m.video_editor_audio_eq_frequency()}
							<Input
								class="mt-0.5 h-8 w-full bg-[oklch(0.22_0.01_50)] text-xs"
								type="number"
								min="20"
								max="22000"
								step="1"
								value={Number(value(band, 'frequencyKey'))}
								disabled={controlsDisabled}
								onchange={(event) =>
									setField(band.frequencyField, event.currentTarget.valueAsNumber)}
							/>
						</label>
						{#if isPass(bandType) && band.slopeField}
							<label class="col-span-2 text-xs text-white/60">
								{m.video_editor_audio_eq_slope()}
								<AppSelect
									value={String(value(band, 'slopeKey'))}
									options={slopeOptions}
									ariaLabel={m.video_editor_audio_eq_slope_aria({ band: band.label() })}
									disabled={controlsDisabled}
									class="mt-0.5 h-8 w-full text-xs"
									onValueChange={(next) => setField(band.slopeField!, Number(next))}
								/>
							</label>
						{:else}
							<label class="text-xs text-white/60">
								{m.video_editor_audio_eq_gain()}
								<Input
									class="mt-0.5 h-8 w-full bg-[oklch(0.22_0.01_50)] text-xs"
									type="number"
									min={AUDIO_EQ_GAIN_DB_MIN}
									max={AUDIO_EQ_GAIN_DB_MAX}
									step="0.1"
									value={Number(value(band, 'gainKey'))}
									disabled={controlsDisabled}
									onchange={(event) => setField(band.gainField, event.currentTarget.valueAsNumber)}
								/>
							</label>
							<label class="text-xs text-white/60">
								Q
								<Input
									class="mt-0.5 h-8 w-full bg-[oklch(0.22_0.01_50)] text-xs"
									type="number"
									min={AUDIO_EQ_Q_MIN}
									max={AUDIO_EQ_Q_MAX}
									step="0.05"
									value={Number(value(band, 'qKey'))}
									disabled={controlsDisabled}
									onchange={(event) => setField(band.qField, event.currentTarget.valueAsNumber)}
								/>
							</label>
						{/if}
					</div>
				</details>
			{/each}
		</div>
	</div>
</details>
