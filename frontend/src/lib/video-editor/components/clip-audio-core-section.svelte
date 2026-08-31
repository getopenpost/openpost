<script lang="ts">
	import DiamondIcon from '@lucide/svelte/icons/diamond';
	import MusicIcon from '@lucide/svelte/icons/music';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import Volume2Icon from '@lucide/svelte/icons/volume-2';
	import { Slider } from '$lib/components/ui/slider';
	import { m } from '$lib/paraglide/messages';
	import {
		clampAudioPitchCents,
		clampAudioPitchSemitones
	} from '$lib/video-editor/audio/audio-pitch';
	import { dbToLinearGain, linearGainToDb } from '$lib/video-editor/media/clip-fades';
	import type { KeyframeProperty, TimelineItem } from '$lib/video-editor/project/types';
	import { resolveAnimatedItemLocalAt } from '$lib/video-editor/timeline/animated-properties';
	import {
		cancelAnimatedPropertyEdit,
		commitAnimatedPropertyEdit,
		setAnimatedProperties,
		updateAnimatedPropertiesLive
	} from '$lib/video-editor/timeline/actions/keyframes';
	import {
		commandHistory,
		executeAtomic
	} from '$lib/video-editor/timeline/commands/command-store.svelte';
	import {
		captureSnapshot,
		restoreSnapshot
	} from '$lib/video-editor/timeline/commands/snapshot.svelte';
	import type { TimelineSnapshot } from '$lib/video-editor/timeline/commands/types';
	import { autoKeyframeStore } from '$lib/video-editor/timeline/stores/auto-keyframe-store.svelte';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { getSynchronizedLinkedItems } from '$lib/video-editor/timeline/utils/linked-items';
	import ScrubbableNumberInput from './scrubbable-number-input.svelte';

	let {
		itemId,
		itemIds = [],
		onedit
	}: { itemId: string; itemIds?: string[]; onedit: () => void } = $props();

	type StaticAudioField =
		| 'audioFadeIn'
		| 'audioFadeOut'
		| 'audioPitchSemitones'
		| 'audioPitchCents';

	const audioItems = $derived.by(() => {
		const selectedIds = itemIds.length > 0 ? itemIds : [itemId];
		const selected = [...new Set(selectedIds)]
			.map((id) => timelineStore.itemById.get(id))
			.filter((item): item is TimelineItem => item !== undefined);
		const selectedAudio = selected.filter((item) => item.type === 'audio');
		if (selectedAudio.length > 0) return selectedAudio;
		const resolved = new Map<string, TimelineItem>();
		for (const item of selected) {
			if (item.type !== 'video') continue;
			const companion = getSynchronizedLinkedItems(timelineStore.items, item.id).find(
				(candidate) => candidate.type === 'audio'
			);
			resolved.set((companion ?? item).id, companion ?? item);
		}
		return [...resolved.values()];
	});
	const selectedIds = $derived(audioItems.map((item) => item.id));
	let gesture = $state<{
		property: KeyframeProperty | StaticAudioField;
		before: TimelineSnapshot;
		changed: boolean;
	} | null>(null);
	let lastPitchWrite = 0;

	function resolvedVolume(item: TimelineItem): number {
		return (
			resolveAnimatedItemLocalAt(item, timelineStore.currentFrame, {
				fps: timelineStore.fps,
				frameWidth: 1920,
				frameHeight: 1080,
				items: timelineStore.items
			}).volume ?? 1
		);
	}

	function mixedValue(valueFor: (item: TimelineItem) => number): number | null {
		if (audioItems.length === 0) return null;
		const values = audioItems.map(valueFor);
		const first = values[0] ?? 0;
		return values.every((value) => Math.abs(value - first) < 0.01) ? first : null;
	}

	function beginGesture(property: KeyframeProperty | StaticAudioField): void {
		if (gesture?.property === property) return;
		if (gesture) restoreSnapshot(gesture.before);
		gesture = { property, before: captureSnapshot(), changed: false };
	}

	function writeGain(db: number): void {
		if (!Number.isFinite(db)) return;
		beginGesture('volume');
		const volume = dbToLinearGain(Math.max(-60, Math.min(12, db)));
		for (const item of audioItems) {
			const changed = updateAnimatedPropertiesLive(
				item.id,
				timelineStore.currentFrame,
				{ volume },
				(property) => autoKeyframeStore.isEnabled(item.id, property)
			);
			if (gesture) gesture.changed ||= changed;
		}
	}

	function fadeLimit(): number {
		return Math.max(
			0,
			Math.min(5, ...audioItems.map((item) => item.durationInFrames / timelineStore.fps))
		);
	}

	function clampStatic(field: StaticAudioField, value: number): number {
		if (field === 'audioPitchSemitones') return clampAudioPitchSemitones(value);
		if (field === 'audioPitchCents') return clampAudioPitchCents(value);
		return Math.max(0, Math.min(fadeLimit(), value));
	}

	function staticValue(item: TimelineItem, field: StaticAudioField): number {
		switch (field) {
			case 'audioFadeIn':
				return item.audioFadeIn ?? 0;
			case 'audioFadeOut':
				return item.audioFadeOut ?? 0;
			case 'audioPitchSemitones':
				return item.audioPitchSemitones ?? 0;
			case 'audioPitchCents':
				return item.audioPitchCents ?? 0;
		}
	}

	function isStaticAudioField(
		property: KeyframeProperty | StaticAudioField
	): property is StaticAudioField {
		return (
			property === 'audioFadeIn' ||
			property === 'audioFadeOut' ||
			property === 'audioPitchSemitones' ||
			property === 'audioPitchCents'
		);
	}

	function writeStatic(field: StaticAudioField, value: number, force = false): void {
		if (!Number.isFinite(value)) return;
		if (field.startsWith('audioPitch') && !force) {
			const now = performance.now();
			if (now - lastPitchWrite < 50) return;
			lastPitchWrite = now;
		}
		beginGesture(field);
		const safe = clampStatic(field, value);
		const updates = audioItems
			.filter((item) => Math.abs(staticValue(item, field) - safe) >= 0.001)
			.map((item) => ({ id: item.id, patch: { [field]: safe } }));
		if (updates.length === 0) return;
		timelineStore._updateItems(updates);
		if (gesture) gesture.changed = true;
	}

	function commit(property: KeyframeProperty | StaticAudioField, value: number): void {
		if (!gesture) {
			if (property === 'volume') writeGain(value);
			else if (isStaticAudioField(property)) writeStatic(property, value, true);
		} else if (isStaticAudioField(property) && property.startsWith('audioPitch')) {
			writeStatic(property, value, true);
		}
		const current = gesture;
		if (!current || current.property !== property) return;
		if (property === 'volume') {
			commitAnimatedPropertyEdit(current.before, selectedIds, ['volume']);
		} else
			commandHistory.addUndoEntry(
				{ type: 'SET_CLIP_AUDIO_PROPERTIES', payload: { ids: selectedIds, property } },
				current.before
			);
		gesture = null;
		if (current.changed) onedit();
	}

	function cancelGesture(): void {
		if (!gesture) return;
		cancelAnimatedPropertyEdit(gesture.before);
		gesture = null;
	}

	function autoKeyEnabled(): boolean {
		return (
			audioItems.length > 0 &&
			audioItems.every((item) => autoKeyframeStore.isEnabled(item.id, 'volume'))
		);
	}

	function toggleAutoKey(): void {
		const enabled = !autoKeyEnabled();
		for (const item of audioItems) {
			if (autoKeyframeStore.isEnabled(item.id, 'volume') !== enabled) {
				autoKeyframeStore.toggle(item.id, 'volume');
			}
		}
	}

	function resetGain(): void {
		let changed = false;
		executeAtomic('RESET_CLIP_GAIN', () => {
			for (const item of audioItems) {
				changed =
					setAnimatedProperties(item.id, timelineStore.currentFrame, { volume: 1 }, (property) =>
						autoKeyframeStore.isEnabled(item.id, property)
					) || changed;
			}
		});
		if (changed) onedit();
	}

	function resetStatic(field: StaticAudioField): void {
		const targets = audioItems.filter((item) => staticValue(item, field) !== 0);
		if (targets.length === 0) return;
		executeAtomic('RESET_CLIP_AUDIO_PROPERTY', () => {
			timelineStore._updateItems(targets.map((item) => ({ id: item.id, patch: { [field]: 0 } })));
		});
		onedit();
	}
</script>

{#snippet control(
	property: 'volume' | StaticAudioField,
	label: string,
	value: number | null,
	min: number,
	max: number,
	step: number,
	unit: string,
	decimals: number
)}
	<div class="grid grid-cols-[4.25rem_minmax(0,1fr)] items-center gap-2 px-2.5 py-2">
		<span class="text-[10px] font-medium text-white/48">{label}</span>
		<div class="flex min-w-0 items-center gap-1">
			<Slider
				class="h-7 min-w-8 flex-1 [&_[data-slot=slider-thumb]]:shadow-none"
				{min}
				{max}
				{step}
				value={value ?? 0}
				ariaLabel={label}
				onValueChange={(nextValue) => {
					beginGesture(property);
					if (property === 'volume') writeGain(nextValue);
					else writeStatic(property, nextValue);
				}}
				onValueCommit={(nextValue) => commit(property, nextValue)}
				onValueCancel={cancelGesture}
				onKeydown={(event) => event.stopPropagation()}
			/>
			<div class="relative w-[4.8rem] shrink-0">
				<ScrubbableNumberInput
					ariaLabel={label}
					{value}
					placeholder={m.video_editor_property_mixed()}
					{min}
					{max}
					{step}
					{decimals}
					class="h-7 w-full rounded border border-white/8 bg-black/18 py-1 pr-6 pl-1.5 text-right text-[11px] tabular-nums outline-none"
					onbegin={() => beginGesture(property)}
					onlive={(next) => (property === 'volume' ? writeGain(next) : writeStatic(property, next))}
					oncommit={(next) => commit(property, next)}
					oncancel={cancelGesture}
				/>
				<span
					class="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-[9px] text-white/30"
					>{unit}</span
				>
			</div>
			{#if property === 'volume'}
				<button
					type="button"
					class:active={autoKeyEnabled()}
					class="grid size-6 shrink-0 place-items-center rounded text-white/38 hover:bg-white/8 hover:text-white/72 focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] [&.active]:text-[oklch(0.78_0.16_55)]"
					aria-label={m.video_editor_property_auto_key({ property: label })}
					aria-pressed={autoKeyEnabled()}
					onclick={toggleAutoKey}
				>
					<DiamondIcon
						class={`size-2.5 ${autoKeyEnabled() ? 'fill-current' : ''}`}
						aria-hidden="true"
					/>
				</button>
			{/if}
			<button
				type="button"
				class="grid size-7 shrink-0 place-items-center rounded text-white/35 hover:bg-white/8 hover:text-white/72 focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
				aria-label={m.video_editor_motion_override_reset({ name: label })}
				onclick={() => (property === 'volume' ? resetGain() : resetStatic(property))}
			>
				<RotateCcwIcon class="size-3.5" aria-hidden="true" />
			</button>
		</div>
	</div>
{/snippet}

{#if audioItems.length > 0}
	<div class="flex flex-col gap-2" data-testid="clip-audio-core-section">
		<section class="overflow-hidden rounded-md border border-white/8 bg-white/[0.025]">
			<h3
				class="flex h-8 items-center gap-2 border-b border-white/7 px-2.5 text-[10px] font-semibold tracking-wider text-white/58 uppercase"
			>
				<Volume2Icon class="size-3.5 text-white/42" aria-hidden="true" />
				{m.video_editor_property_audio()}
			</h3>
			<div class="divide-y divide-white/6">
				{@render control(
					'volume',
					m.video_editor_clip_gain_db(),
					mixedValue((item) => linearGainToDb(resolvedVolume(item))),
					-60,
					12,
					0.1,
					'dB',
					1
				)}
				{@render control(
					'audioFadeIn',
					m.video_editor_clip_fade_in_seconds(),
					mixedValue((item) => item.audioFadeIn ?? 0),
					0,
					fadeLimit(),
					0.05,
					's',
					2
				)}
				{@render control(
					'audioFadeOut',
					m.video_editor_clip_fade_out_seconds(),
					mixedValue((item) => item.audioFadeOut ?? 0),
					0,
					fadeLimit(),
					0.05,
					's',
					2
				)}
			</div>
		</section>
		<section class="overflow-hidden rounded-md border border-white/8 bg-white/[0.025]">
			<h3
				class="flex h-8 items-center gap-2 border-b border-white/7 px-2.5 text-[10px] font-semibold tracking-wider text-white/58 uppercase"
			>
				<MusicIcon class="size-3.5 text-white/42" aria-hidden="true" />
				{m.video_editor_audio_pitch()}
			</h3>
			<div class="divide-y divide-white/6">
				{@render control(
					'audioPitchSemitones',
					m.video_editor_audio_semitones(),
					mixedValue((item) => item.audioPitchSemitones ?? 0),
					-12,
					12,
					1,
					'st',
					0
				)}
				{@render control(
					'audioPitchCents',
					m.video_editor_audio_cents(),
					mixedValue((item) => item.audioPitchCents ?? 0),
					-100,
					100,
					1,
					'ct',
					0
				)}
			</div>
		</section>
	</div>
{/if}
