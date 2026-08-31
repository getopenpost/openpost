<script lang="ts">
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Slider } from '$lib/components/ui/slider';
	import { m } from '$lib/paraglide/messages';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import { setCurrentFrame } from '$lib/video-editor/timeline/actions/items';
	import { sequenceStore } from '$lib/video-editor/sequences/sequence-store.svelte';
	import type {
		AnimationPreset,
		MotionModifierChannel,
		MotionModifierType
	} from '$lib/video-editor/project/types';
	import type { TimelineSnapshot } from '$lib/video-editor/timeline/commands/types';
	import {
		applyMotionPreset,
		canApplyMotionPreset,
		type MotionPresetApplyMode
	} from '$lib/video-editor/timeline/actions/motion-presets';
	import {
		MOTION_PRESET_CATEGORIES,
		MOTION_PRESETS,
		type MotionPreset,
		type MotionPresetCategory,
		type MotionPresetId
	} from '$lib/video-editor/timeline/motion-presets';
	import {
		MOTION_MODULATORS,
		type MotionModulator
	} from '$lib/video-editor/timeline/motion-modulators';
	import {
		createMotionModifier,
		getMotionModifierSettings,
		updateMotionModifierSettings,
		type MotionModifierSettingsUpdate
	} from '$lib/video-editor/timeline/motion-modifier-eval';
	import {
		applyMotionModifierToItems,
		bakeMotionToKeyframes,
		beginMotionModifierEdit,
		commitMotionModifierEdit,
		removeMotionModifierFromItems,
		updateMotionModifiersLive
	} from '$lib/video-editor/timeline/actions/motion-modifiers';
	import {
		applyMotionPresetAsLayers,
		removeMotionLayerFromItems,
		setMotionLayerEnabled
	} from '$lib/video-editor/timeline/actions/motion-layers';
	import { trimAnimationToItemBounds } from '$lib/video-editor/timeline/actions/trimmed-keyframes';
	import { countTrimmedKeyframes } from '$lib/video-editor/timeline/trimmed-keyframes';
	import {
		animationKeyframeApplications,
		clearManualKeyframesForItems,
		manualKeyframeSummary,
		removeAnimationKeyframeApplication
	} from '$lib/video-editor/timeline/actions/keyframes';
	import ListFilterIcon from '@lucide/svelte/icons/list-filter';
	import SearchIcon from '@lucide/svelte/icons/search';
	import XIcon from '@lucide/svelte/icons/x';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import Layers3Icon from '@lucide/svelte/icons/layers-3';
	import SavedAnimationLibrary from './saved-animation-library.svelte';

	let {
		itemId,
		itemIds = [],
		frameWidth,
		frameHeight,
		fps,
		animationPresets = [],
		onsavepreset = () => {},
		ondeletepreset = () => {},
		variant = 'motion',
		onmotionclip,
		onedit
	}: {
		itemId: string | null;
		itemIds?: string[];
		frameWidth: number;
		frameHeight: number;
		fps: number;
		animationPresets?: AnimationPreset[];
		onsavepreset?: (preset: AnimationPreset) => void;
		ondeletepreset?: (presetId: string) => void;
		variant?: 'edit' | 'motion';
		onmotionclip?: () => void;
		onedit: () => void;
	} = $props();

	let mode = $state<MotionPresetApplyMode>('replace');
	let durationScale = $state(1);
	let intensityScale = $state(1);
	let staggerFrames = $state(0);
	let status = $state('');
	let modifierEditSnapshot = $state<TimelineSnapshot | null>(null);
	let modifierEditType = $state<MotionModifierType | null>(null);
	let bakeConfirmationOpen = $state(false);
	let searchQuery = $state('');
	let compatibleOnly = $state(false);

	const selectedIds = $derived(itemId ? [...new Set([itemId, ...itemIds])].filter(Boolean) : []);
	const selectedItems = $derived(
		selectedIds.flatMap((id) => {
			const item = timelineStore.itemById.get(id);
			return item ? [item] : [];
		})
	);
	const selectedItem = $derived(selectedItems[0]);
	const selectedAppliedItems = $derived(selectedItem ? [selectedItem] : []);
	const selectedAppliedIds = $derived(selectedItem ? [selectedItem.id] : []);
	const additiveLayers = $derived(() => {
		const map = new Map<
			string,
			{ id: string; name: string; enabled: boolean; sourcePresetId: string }
		>();
		for (const item of selectedItems) {
			for (const layer of item.motionLayers ?? []) {
				if (!map.has(layer.id)) map.set(layer.id, layer);
			}
		}
		return [...map.values()].toSorted((a, b) => a.name.localeCompare(b.name));
	});
	const liveMotionItemCount = $derived(
		selectedItems.filter((item) => item.motionModifiers?.some((modifier) => modifier.enabled))
			.length
	);
	const generatedApplications = $derived(animationKeyframeApplications(selectedAppliedItems));
	const manualSummary = $derived(manualKeyframeSummary(selectedAppliedItems));
	const activeModifiers = $derived(() => {
		const types = new Set<MotionModifierType>();
		for (const item of selectedItems) {
			for (const modifier of item.motionModifiers ?? []) {
				if (modifier.enabled) types.add(modifier.type);
			}
		}
		return MOTION_MODULATORS.filter((modulator) => types.has(modulator.id));
	});
	const hasAppliedAnimation = $derived(
		generatedApplications.length > 0 ||
			manualSummary.keyframeCount > 0 ||
			additiveLayers().length > 0 ||
			activeModifiers().length > 0
	);
	const selectedIsMotionClip = $derived(
		selectedItems.length === 1 &&
			selectedItems[0]?.type === 'composition' &&
			sequenceStore.compositionById.get(selectedItems[0].compositionId)?.editorKind ===
				'composite-2d'
	);
	const parkedKeyframeCount = $derived(
		selectedItems.reduce((count, item) => count + countTrimmedKeyframes(item), 0)
	);

	const labels = $derived<Record<MotionPresetId, string>>({
		'fade-in': m.video_editor_motion_fade_in(),
		'slide-in-left': m.video_editor_motion_slide_in_left(),
		'slide-in-right': m.video_editor_motion_slide_in_right(),
		'slide-in-up': m.video_editor_motion_slide_in_up(),
		'slide-in-down': m.video_editor_motion_slide_in_down(),
		'pop-in': m.video_editor_motion_pop_in(),
		'zoom-in': m.video_editor_motion_zoom_in(),
		'spin-in': m.video_editor_motion_spin_in(),
		'bounce-in': m.video_editor_motion_bounce_in(),
		'fade-out': m.video_editor_motion_fade_out(),
		'slide-out-left': m.video_editor_motion_slide_out_left(),
		'slide-out-right': m.video_editor_motion_slide_out_right(),
		'slide-out-up': m.video_editor_motion_slide_out_up(),
		'slide-out-down': m.video_editor_motion_slide_out_down(),
		'pop-out': m.video_editor_motion_pop_out(),
		'zoom-out': m.video_editor_motion_zoom_out(),
		pulse: m.video_editor_motion_pulse(),
		shake: m.video_editor_motion_shake(),
		wobble: m.video_editor_motion_wobble(),
		flash: m.video_editor_motion_flash()
	});

	const categoryLabels = $derived<Record<MotionPresetCategory, string>>({
		entrance: m.video_editor_motion_entrance(),
		exit: m.video_editor_motion_exit(),
		emphasis: m.video_editor_motion_emphasis()
	});
	const modulatorLabels = $derived<Record<MotionModifierType, string>>({
		'float-drift': m.video_editor_motion_float_drift(),
		sway: m.video_editor_motion_sway(),
		'breath-pulse': m.video_editor_motion_breath_pulse(),
		spin: m.video_editor_motion_live_spin(),
		'micro-shake': m.video_editor_motion_micro_shake()
	});
	const channelLabels = $derived<Record<MotionModifierChannel, string>>({
		x: m.video_editor_motion_channel_x(),
		y: m.video_editor_motion_channel_y(),
		width: m.video_editor_motion_channel_width(),
		height: m.video_editor_motion_channel_height(),
		scaleX: `${m.video_editor_expression_scale()} X`,
		scaleY: `${m.video_editor_expression_scale()} Y`,
		rotation: m.video_editor_motion_channel_rotation(),
		opacity: m.video_editor_motion_channel_opacity()
	});

	function presetsFor(category: MotionPresetCategory): MotionPreset[] {
		const query = searchQuery.trim().toLocaleLowerCase();
		return MOTION_PRESETS.filter(
			(preset) =>
				preset.category === category &&
				(!query || labels[preset.id].toLocaleLowerCase().includes(query)) &&
				(!compatibleOnly || disabledReason(preset) === null)
		);
	}

	function visibleModulators(): MotionModulator[] {
		const query = searchQuery.trim().toLocaleLowerCase();
		return MOTION_MODULATORS.filter(
			(modulator) =>
				(!query || modulatorLabels[modulator.id].toLocaleLowerCase().includes(query)) &&
				(!compatibleOnly || modulatorReason(modulator) === null)
		);
	}

	function disabledReason(preset: MotionPreset): string | null {
		if (selectedItems.length === 0) return m.video_editor_motion_select_clip();
		if (selectedItems.some((item) => !canApplyMotionPreset(item, preset))) {
			return m.video_editor_motion_incompatible();
		}
		return null;
	}

	function modulatorReason(modulator: MotionModulator): string | null {
		if (selectedItems.length === 0) return m.video_editor_motion_select_clip();
		if (
			selectedItems.some(
				(item) =>
					!['video', 'image', 'lottie', 'text', 'subtitle', 'shape', 'composition'].includes(
						item.type
					)
			)
		) {
			return m.video_editor_motion_incompatible();
		}
		return null;
	}

	function modifierActiveOnEveryItem(type: MotionModifierType): boolean {
		return (
			selectedItems.length > 0 &&
			selectedItems.every((item) =>
				item.motionModifiers?.some((modifier) => modifier.type === type && modifier.enabled)
			)
		);
	}

	function toggleModulator(modulator: MotionModulator): void {
		const reason = modulatorReason(modulator);
		if (reason) {
			status = reason;
			return;
		}
		if (modifierActiveOnEveryItem(modulator.id)) {
			const removed = removeMotionModifierFromItems(selectedIds, modulator.id);
			if (removed > 0) {
				status = m.video_editor_motion_live_removed({ name: modulatorLabels[modulator.id] });
				onedit();
			}
			return;
		}
		const applied = applyMotionModifierToItems(
			selectedItems.map((item, index) => ({
				itemId: item.id,
				modifier: createMotionModifier(
					modulator.id,
					{ durationScale, intensityScale, staggerFrames },
					index
				)
			}))
		);
		if (applied > 0) {
			status = m.video_editor_motion_live_applied({
				name: modulatorLabels[modulator.id],
				count: String(applied)
			});
			onedit();
		}
	}

	function currentModifierSettings(type: MotionModifierType) {
		const modifier = selectedItems
			.flatMap((item) => item.motionModifiers ?? [])
			.find((entry) => entry.type === type && entry.enabled);
		return modifier ? getMotionModifierSettings(modifier) : null;
	}

	function modifierAssignments(type: MotionModifierType, update: MotionModifierSettingsUpdate) {
		return selectedItems.flatMap((item) => {
			const modifier = item.motionModifiers?.find((entry) => entry.type === type && entry.enabled);
			return modifier
				? [{ itemId: item.id, modifier: updateMotionModifierSettings(modifier, update) }]
				: [];
		});
	}

	function liveModifierEdit(type: MotionModifierType, update: MotionModifierSettingsUpdate): void {
		const assignments = modifierAssignments(type, update);
		if (assignments.length === 0) return;
		if (!modifierEditSnapshot || modifierEditType !== type) {
			modifierEditSnapshot = beginMotionModifierEdit();
			modifierEditType = type;
		}
		updateMotionModifiersLive(assignments);
	}

	function commitModifierEdit(
		type: MotionModifierType,
		update: MotionModifierSettingsUpdate
	): void {
		const assignments = modifierAssignments(type, update);
		if (assignments.length === 0) return;
		if (modifierEditSnapshot && modifierEditType === type) {
			updateMotionModifiersLive(assignments);
			commitMotionModifierEdit(
				modifierEditSnapshot,
				type,
				assignments.map((assignment) => assignment.itemId)
			);
		} else {
			applyMotionModifierToItems(assignments);
		}
		modifierEditSnapshot = null;
		modifierEditType = null;
		onedit();
	}

	function applyPreset(preset: MotionPreset): void {
		const reason = disabledReason(preset);
		if (reason) {
			status = reason;
			return;
		}
		const result = applyMotionPreset({
			itemIds: selectedIds,
			presetId: preset.id,
			mode,
			frameWidth,
			frameHeight,
			fps,
			presetName: labels[preset.id],
			settings: { durationScale, intensityScale, staggerFrames }
		});
		if (result.ok) {
			status = m.video_editor_motion_applied({
				name: labels[preset.id],
				count: String(selectedItems.length)
			});
			onedit();
			return;
		}
		status =
			result.reason === 'transition-blocked'
				? m.video_editor_motion_transition_blocked()
				: result.reason === 'no-change'
					? m.video_editor_motion_no_change()
					: m.video_editor_motion_incompatible();
	}

	function applyPresetAsLayer(preset: MotionPreset): void {
		const reason = disabledReason(preset);
		if (reason) {
			status = reason;
			return;
		}
		const applied = applyMotionPresetAsLayers({
			itemIds: selectedIds,
			presetId: preset.id,
			frameWidth,
			frameHeight,
			fps,
			durationScale,
			intensityScale,
			staggerFrames
		});
		if (applied > 0) {
			status = m.video_editor_motion_layer_applied({
				name: labels[preset.id],
				count: String(applied)
			});
			onedit();
			return;
		}
		status = m.video_editor_motion_no_change();
	}

	function toggleLayer(layerId: string, enabled: boolean): void {
		const updated = setMotionLayerEnabled(selectedIds, layerId, enabled);
		if (updated > 0) onedit();
	}

	function removeLayer(layerId: string): void {
		const removed = removeMotionLayerFromItems(selectedIds, layerId);
		if (removed > 0) {
			status = m.video_editor_motion_layer_removed();
			onedit();
		}
	}

	function clearManualKeyframes(): void {
		const result = clearManualKeyframesForItems(selectedAppliedIds);
		if (result.keyframesRemoved === 0) return;
		status = m.video_editor_motion_keyframes_cleared({
			count: String(result.keyframesRemoved)
		});
		onedit();
	}

	function navigateToItemFrame(relativeFrame: number): void {
		if (!selectedItem) return;
		editorSession.pausePlayback();
		setCurrentFrame(
			selectedItem.from +
				Math.max(0, Math.min(selectedItem.durationInFrames - 1, Math.round(relativeFrame)))
		);
	}

	function removeGeneratedApplication(applicationId: string): void {
		const result = removeAnimationKeyframeApplication(selectedAppliedIds, applicationId);
		if (result.keyframesRemoved === 0) return;
		status = m.video_editor_motion_keyframes_cleared({
			count: String(result.keyframesRemoved)
		});
		onedit();
	}

	function confirmBake(): void {
		const result = bakeMotionToKeyframes({ itemIds: selectedIds, fps, frameWidth, frameHeight });
		bakeConfirmationOpen = false;
		if (result.ok) {
			status = m.video_editor_motion_bake_success({
				count: String(result.bakedItems),
				keyframes: String(result.writtenKeyframes)
			});
			onedit();
			return;
		}
		status =
			result.reason === 'transition-blocked'
				? m.video_editor_motion_bake_transition_blocked()
				: m.video_editor_motion_bake_no_change();
	}

	function trimAnimation(): void {
		const result = trimAnimationToItemBounds(selectedIds);
		if (result.ok) {
			status = m.video_editor_motion_trim_success({ count: String(result.removedCount) });
			onedit();
			return;
		}
		status =
			result.reason === 'transition-blocked'
				? m.video_editor_motion_trim_transition_blocked()
				: m.video_editor_motion_trim_no_change();
	}

	function modeLabel(): string {
		return mode === 'replace' ? m.video_editor_motion_replace() : m.video_editor_motion_add();
	}
</script>

<section class="motion-panel" aria-labelledby="motion-panel-title">
	<div class="motion-heading">
		<div>
			<h2 id="motion-panel-title">{m.video_editor_motion_title()}</h2>
			<p>{m.video_editor_motion_description()}</p>
		</div>
		<span class="selection-count"
			>{m.video_editor_motion_selected({ count: String(selectedItems.length) })}</span
		>
	</div>

	{#if variant === 'edit' && onmotionclip}
		<section class="motion-clip-card">
			<Layers3Icon aria-hidden="true" />
			<div>
				<h3>{m.video_editor_motion_clip_title()}</h3>
				<p>
					{selectedIsMotionClip
						? m.video_editor_motion_clip_open_hint()
						: m.video_editor_motion_clip_create_hint()}
				</p>
				<button type="button" onclick={onmotionclip}>
					{#if selectedIsMotionClip}
						<ExternalLinkIcon aria-hidden="true" />
						{m.video_editor_motion_clip_open()}
					{:else}
						<Layers3Icon aria-hidden="true" />
						{m.video_editor_motion_clip_create()}
					{/if}
				</button>
			</div>
		</section>
	{/if}

	<div class="motion-search-row">
		<label class="motion-search">
			<span class="sr-only">{m.video_editor_motion_search()}</span>
			<SearchIcon aria-hidden="true" />
			<Input
				type="search"
				bind:value={searchQuery}
				placeholder={m.video_editor_motion_search()}
				aria-label={m.video_editor_motion_search()}
				class="h-8 min-h-0 border-[oklch(0.3_0.018_55)] bg-[oklch(0.135_0.01_55)] pr-8 pl-7 text-xs"
			/>
			{#if searchQuery}
				<button
					type="button"
					class="motion-search-clear"
					aria-label={m.video_editor_motion_search_clear()}
					onclick={() => (searchQuery = '')}
				>
					<XIcon aria-hidden="true" />
				</button>
			{/if}
		</label>
		<button
			type="button"
			class="compatibility-filter"
			class:active={compatibleOnly}
			aria-pressed={compatibleOnly}
			title={m.video_editor_motion_compatible_only_hint()}
			onclick={() => (compatibleOnly = !compatibleOnly)}
		>
			<ListFilterIcon aria-hidden="true" />
			{m.video_editor_motion_compatible_only()}
		</button>
	</div>

	{#if hasAppliedAnimation}
		<section class="motion-applied" aria-labelledby="motion-applied-title">
			<h3 id="motion-applied-title">{m.video_editor_motion_applied_title()}</h3>
			<div class="applied-list">
				{#each generatedApplications as application (application.applicationId)}
					<div class="applied-row">
						<button
							type="button"
							class="applied-row-content"
							onclick={() => navigateToItemFrame(application.firstFrame)}
						>
							<strong>{application.presetName}</strong>
							<span
								>{m.video_editor_motion_preset_keyframes_summary({
									keyframes: String(application.keyframeCount),
									properties: String(application.propertyCount)
								})}</span
							>
						</button>
						<button
							type="button"
							aria-label={m.video_editor_motion_layer_remove_named({
								name: application.presetName
							})}
							onclick={() => removeGeneratedApplication(application.applicationId)}
						>
							{m.video_editor_motion_layer_remove()}
						</button>
					</div>
				{/each}
				{#if manualSummary.keyframeCount > 0}
					<div class="applied-row">
						<button
							type="button"
							class="applied-row-content"
							disabled={manualSummary.firstFrame === null}
							onclick={() => navigateToItemFrame(manualSummary.firstFrame ?? 0)}
						>
							<strong>{m.video_editor_motion_manual_keyframes()}</strong>
							<span
								>{m.video_editor_clear_keyframes_affected({
									count: String(manualSummary.keyframeCount)
								})}</span
							>
						</button>
						<button type="button" onclick={clearManualKeyframes}>
							{m.video_editor_clear_keyframes_confirm({
								count: String(manualSummary.keyframeCount)
							})}
						</button>
					</div>
				{/if}
				{#each additiveLayers() as layer (layer.id)}
					<div class="applied-row">
						<label>
							<Checkbox
								checked={layer.enabled}
								aria-label={m.video_editor_motion_layer_toggle_named({ name: layer.name })}
								onCheckedChange={(checked) => toggleLayer(layer.id, checked === true)}
							/>
							<span>{layer.name}</span>
						</label>
						<button
							type="button"
							aria-label={m.video_editor_motion_layer_remove_named({ name: layer.name })}
							onclick={() => removeLayer(layer.id)}
						>
							{m.video_editor_motion_layer_remove()}
						</button>
					</div>
				{/each}
				{#each activeModifiers() as modulator (modulator.id)}
					<div class="applied-row">
						<div>
							<strong>{modulatorLabels[modulator.id]}</strong>
							<span>{m.video_editor_motion_live_badge()}</span>
						</div>
						<button
							type="button"
							aria-label={m.video_editor_motion_live_remove_named({
								name: modulatorLabels[modulator.id]
							})}
							onclick={() => toggleModulator(modulator)}
						>
							{m.video_editor_motion_live_remove()}
						</button>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<div class="mode-control" role="group" aria-label={m.video_editor_motion_apply_mode()}>
		<button
			type="button"
			class:active={mode === 'replace'}
			aria-pressed={mode === 'replace'}
			onclick={() => (mode = 'replace')}
		>
			{m.video_editor_motion_replace()}
		</button>
		<button
			type="button"
			class:active={mode === 'add'}
			aria-pressed={mode === 'add'}
			onclick={() => (mode = 'add')}
		>
			{m.video_editor_motion_add()}
		</button>
	</div>
	<p class="mode-hint">
		{mode === 'replace' ? m.video_editor_motion_replace_hint() : m.video_editor_motion_add_hint()}
	</p>

	<div class="generator-controls">
		<label>
			<span>{m.video_editor_motion_duration()}</span>
			<output>{Math.round(durationScale * 100)}%</output>
			<Slider
				min={0.25}
				max={3}
				step={0.05}
				bind:value={durationScale}
				ariaLabel={m.video_editor_motion_duration()}
			/>
		</label>
		<label>
			<span>{m.video_editor_motion_intensity()}</span>
			<output>{Math.round(intensityScale * 100)}%</output>
			<Slider
				min={0}
				max={2}
				step={0.05}
				bind:value={intensityScale}
				ariaLabel={m.video_editor_motion_intensity()}
			/>
		</label>
		<label>
			<span>{m.video_editor_motion_stagger()}</span>
			<output>{staggerFrames}</output>
			<Slider
				min={0}
				max={30}
				step={1}
				bind:value={staggerFrames}
				ariaLabel={m.video_editor_motion_stagger()}
			/>
		</label>
	</div>

	<div class="preset-library">
		{#each MOTION_PRESET_CATEGORIES as category}
			{@const visiblePresets = presetsFor(category)}
			{#if visiblePresets.length > 0}
				<section class="preset-group" aria-labelledby={`motion-category-${category}`}>
					<h3 id={`motion-category-${category}`}>{categoryLabels[category]}</h3>
					<div class="preset-grid">
						{#each visiblePresets as preset (preset.id)}
							{@const reason = disabledReason(preset)}
							<div class="preset-tile-wrap">
								<button
									type="button"
									class="preset-tile"
									disabled={reason !== null}
									title={reason ??
										m.video_editor_motion_apply_named({
											mode: modeLabel(),
											name: labels[preset.id]
										})}
									aria-label={m.video_editor_motion_apply_named({
										mode: modeLabel(),
										name: labels[preset.id]
									})}
									data-kind={preset.thumbnail.kind}
									data-category={preset.category}
									data-angle={preset.thumbnail.angle ?? 0}
									data-direction={preset.thumbnail.direction ?? 1}
									onclick={() => applyPreset(preset)}
								>
									<span class="thumbnail" aria-hidden="true">
										<span class="motion-glyph"></span>
										<span class="motion-origin"></span>
									</span>
									<span>{labels[preset.id]}</span>
								</button>
								<button
									type="button"
									class="layer-add-btn"
									disabled={reason !== null}
									aria-label={m.video_editor_motion_add_layer_named({ name: labels[preset.id] })}
									title={reason ??
										m.video_editor_motion_add_layer_named({ name: labels[preset.id] })}
									onclick={() => applyPresetAsLayer(preset)}
								>
									{m.video_editor_motion_add_layer()}
								</button>
							</div>
						{/each}
					</div>
				</section>
			{/if}
		{/each}
	</div>
	{#if MOTION_PRESET_CATEGORIES.every((category) => presetsFor(category).length === 0) && visibleModulators().length === 0}
		<p class="motion-no-results">{m.video_editor_motion_no_results()}</p>
	{/if}

	{#if visibleModulators().length > 0 || activeModifiers().length > 0}
		<section class="live-library" aria-labelledby="live-motion-title">
			<div class="live-heading">
				<div>
					<h3 id="live-motion-title">{m.video_editor_motion_live_title()}</h3>
					<p>{m.video_editor_motion_live_description()}</p>
				</div>
				<span>{m.video_editor_motion_live_badge()}</span>
			</div>
			<div class="preset-grid live-grid">
				{#each visibleModulators() as modulator (modulator.id)}
					{@const reason = modulatorReason(modulator)}
					{@const active = modifierActiveOnEveryItem(modulator.id)}
					<button
						type="button"
						class="preset-tile live-tile"
						class:active
						disabled={reason !== null}
						aria-pressed={active}
						aria-label={active
							? m.video_editor_motion_live_remove_named({ name: modulatorLabels[modulator.id] })
							: m.video_editor_motion_live_apply_named({ name: modulatorLabels[modulator.id] })}
						title={reason ??
							(active
								? m.video_editor_motion_live_click_remove()
								: m.video_editor_motion_live_click_apply())}
						data-kind={modulator.thumbnail.kind}
						onclick={() => toggleModulator(modulator)}
					>
						<span class="thumbnail" aria-hidden="true">
							<span class="motion-glyph"></span>
							<span class="motion-origin"></span>
						</span>
						<span>{modulatorLabels[modulator.id]}</span>
						{#if active}<span class="active-dot">{m.video_editor_motion_live_badge()}</span>{/if}
					</button>
				{/each}
			</div>

			{#each MOTION_MODULATORS.filter( (modulator) => modifierActiveOnEveryItem(modulator.id) ) as modulator (modulator.id)}
				{@const settings = currentModifierSettings(modulator.id)}
				{#if settings}
					<div class="live-editor">
						<div class="live-editor-heading">
							<strong>{modulatorLabels[modulator.id]}</strong>
							<button type="button" onclick={() => toggleModulator(modulator)}>
								{m.video_editor_motion_live_remove()}
							</button>
						</div>
						<div class="generator-controls live-controls">
							<label>
								<span>{m.video_editor_motion_intensity()}</span>
								<output>{Math.round(settings.intensityScale * 100)}%</output>
								<Slider
									min={0}
									max={2}
									step={0.05}
									value={settings.intensityScale}
									ariaLabel={m.video_editor_motion_intensity()}
									onValueChange={(value) =>
										liveModifierEdit(modulator.id, { intensityScale: value })}
									onValueCommit={(value) =>
										commitModifierEdit(modulator.id, { intensityScale: value })}
								/>
							</label>
							<label>
								<span>{m.video_editor_motion_duration()}</span>
								<output>{Math.round(settings.durationScale * 100)}%</output>
								<Slider
									min={0.25}
									max={3}
									step={0.05}
									value={settings.durationScale}
									ariaLabel={m.video_editor_motion_duration()}
									onValueChange={(value) =>
										liveModifierEdit(modulator.id, { durationScale: value })}
									onValueCommit={(value) =>
										commitModifierEdit(modulator.id, { durationScale: value })}
								/>
							</label>
							{#each modulator.properties as channel}
								<label>
									<span>{channelLabels[channel]}</span>
									<output>{Math.round((settings.channelGains[channel] ?? 1) * 100)}%</output>
									<Slider
										min={0}
										max={2}
										step={0.05}
										value={settings.channelGains[channel] ?? 1}
										ariaLabel={channelLabels[channel]}
										onValueChange={(value) =>
											liveModifierEdit(modulator.id, { channelGains: { [channel]: value } })}
										onValueCommit={(value) =>
											commitModifierEdit(modulator.id, { channelGains: { [channel]: value } })}
									/>
								</label>
							{/each}
						</div>
					</div>
				{/if}
			{/each}

			{#if liveMotionItemCount > 0}
				<div class="motion-utility" data-kind="bake">
					<div>
						<strong>{m.video_editor_motion_bake_title()}</strong>
						<p>{m.video_editor_motion_bake_description({ count: String(liveMotionItemCount) })}</p>
					</div>
					{#if bakeConfirmationOpen}
						<div
							class="confirmation"
							role="group"
							aria-label={m.video_editor_motion_bake_confirm_title()}
						>
							<p>{m.video_editor_motion_bake_confirm_description()}</p>
							<div>
								<button
									type="button"
									class="secondary"
									onclick={() => (bakeConfirmationOpen = false)}
								>
									{m.video_editor_motion_bake_cancel()}
								</button>
								<button type="button" class="primary" onclick={confirmBake}>
									{m.video_editor_motion_bake_confirm()}
								</button>
							</div>
						</div>
					{:else}
						<button type="button" class="primary" onclick={() => (bakeConfirmationOpen = true)}>
							{m.video_editor_motion_bake_action()}
						</button>
					{/if}
				</div>
			{/if}
		</section>
	{/if}

	{#if parkedKeyframeCount > 0}
		<section class="motion-utility trim-utility" aria-labelledby="trim-animation-title">
			<div>
				<strong id="trim-animation-title">{m.video_editor_motion_trim_title()}</strong>
				<p>{m.video_editor_motion_trim_description({ count: String(parkedKeyframeCount) })}</p>
			</div>
			<button type="button" class="secondary" onclick={trimAnimation}>
				{m.video_editor_motion_trim_action()}
			</button>
		</section>
	{/if}

	<SavedAnimationLibrary
		{itemId}
		{itemIds}
		presets={animationPresets}
		{mode}
		query={searchQuery}
		{compatibleOnly}
		showFilters={false}
		{onsavepreset}
		{ondeletepreset}
		{onedit}
	/>

	<p class="motion-status" aria-live="polite">{status}</p>
</section>

<style>
	.motion-panel {
		margin-top: 0.5rem;
		border-top: 1px solid oklch(0.25 0.015 55);
		padding-top: 0.75rem;
		color: oklch(0.92 0.012 70);
	}
	.motion-heading {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}
	h2,
	h3,
	p {
		margin: 0;
	}
	h2 {
		font-size: 0.75rem;
		font-weight: 650;
		letter-spacing: 0.01em;
	}
	.motion-heading p,
	.mode-hint,
	.motion-status {
		margin-top: 0.2rem;
		font-size: 0.625rem;
		line-height: 1.4;
		color: oklch(0.67 0.018 65);
	}
	.selection-count {
		flex: none;
		border: 1px solid oklch(0.31 0.02 58);
		border-radius: 999px;
		padding: 0.15rem 0.4rem;
		font-size: 0.5625rem;
		color: oklch(0.72 0.02 68);
	}
	.motion-clip-card {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.55rem;
		margin-top: 0.65rem;
		border: 1px solid oklch(0.3 0.024 55);
		border-radius: 0.45rem;
		padding: 0.55rem;
		background: oklch(0.18 0.015 55 / 0.8);
	}
	.motion-clip-card > :global(svg) {
		width: 1rem;
		height: 1rem;
		color: oklch(0.68 0.11 45);
	}
	.motion-clip-card h3 {
		font-size: 0.625rem;
		font-weight: 700;
	}
	.motion-clip-card p {
		margin-top: 0.15rem;
		font-size: 0.55rem;
		line-height: 1.4;
		color: oklch(0.64 0.018 65);
	}
	.motion-clip-card button {
		display: flex;
		min-height: 1.75rem;
		align-items: center;
		gap: 0.3rem;
		margin-top: 0.45rem;
		border: 1px solid oklch(0.38 0.045 45);
		border-radius: 0.32rem;
		padding: 0.25rem 0.5rem;
		background: oklch(0.24 0.025 45);
		color: oklch(0.88 0.025 60);
		font-size: 0.55rem;
		font-weight: 700;
		cursor: pointer;
	}
	.motion-clip-card button :global(svg) {
		width: 0.75rem;
		height: 0.75rem;
	}
	.motion-clip-card button:hover {
		background: oklch(0.3 0.04 45);
	}
	.motion-clip-card button:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 2px;
	}
	.motion-search-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.35rem;
		margin-top: 0.65rem;
	}
	.motion-search {
		position: relative;
		min-width: 0;
	}
	.motion-search > :global(svg:first-of-type) {
		position: absolute;
		top: 50%;
		left: 0.5rem;
		z-index: 1;
		width: 0.8rem;
		height: 0.8rem;
		transform: translateY(-50%);
		color: oklch(0.58 0.016 65);
	}
	.motion-search-clear {
		position: absolute;
		top: 50%;
		right: 0.25rem;
		display: grid;
		width: 1.5rem;
		height: 1.5rem;
		place-items: center;
		border: 0;
		border-radius: 0.25rem;
		background: transparent;
		transform: translateY(-50%);
		color: oklch(0.65 0.018 65);
		cursor: pointer;
	}
	.motion-search-clear :global(svg),
	.compatibility-filter :global(svg) {
		width: 0.75rem;
		height: 0.75rem;
	}
	.compatibility-filter {
		display: flex;
		min-height: 2rem;
		align-items: center;
		gap: 0.3rem;
		border: 1px solid oklch(0.3 0.018 55);
		border-radius: 0.35rem;
		padding: 0.3rem 0.45rem;
		background: oklch(0.17 0.012 55);
		color: oklch(0.68 0.018 65);
		font-size: 0.55rem;
		font-weight: 650;
		cursor: pointer;
	}
	.compatibility-filter.active {
		border-color: oklch(0.5 0.09 45);
		background: oklch(0.27 0.045 45);
		color: oklch(0.92 0.03 60);
	}
	.motion-applied {
		display: grid;
		gap: 0.4rem;
		margin-top: 0.65rem;
		border: 1px solid oklch(0.3 0.024 55);
		border-radius: 0.45rem;
		padding: 0.5rem;
		background: oklch(0.18 0.015 55 / 0.8);
	}
	.motion-applied > h3 {
		font-size: 0.55rem;
		font-weight: 750;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: oklch(0.68 0.02 65);
	}
	.applied-list {
		display: grid;
		gap: 0.3rem;
	}
	.applied-row {
		display: flex;
		min-height: 2rem;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		border-radius: 0.32rem;
		padding: 0.3rem 0.4rem;
		background: oklch(0.145 0.01 55);
	}
	.applied-row > div,
	.applied-row > label,
	.applied-row-content {
		display: flex;
		min-width: 0;
		min-height: 2rem;
		align-items: center;
		gap: 0.35rem;
	}
	.applied-row strong,
	.applied-row label > span {
		overflow: hidden;
		font-size: 0.6rem;
		font-weight: 650;
		color: oklch(0.88 0.018 65);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.applied-row div > span,
	.applied-row-content > span {
		font-size: 0.5rem;
		color: oklch(0.6 0.018 65);
	}
	.applied-row button {
		flex: none;
		min-height: 1.55rem;
		border: 0;
		border-radius: 0.28rem;
		padding: 0.2rem 0.4rem;
		background: transparent;
		color: oklch(0.72 0.055 35);
		font-size: 0.53rem;
		cursor: pointer;
	}
	.applied-row .applied-row-content {
		flex: 1;
		justify-content: flex-start;
		min-width: 0;
		padding: 0.2rem;
		color: inherit;
		text-align: left;
	}
	.applied-row .applied-row-content:hover:not(:disabled) {
		background: oklch(0.2 0.015 55);
	}
	.applied-row .applied-row-content:disabled {
		cursor: default;
	}
	.applied-row button:hover,
	.motion-search-clear:hover {
		background: oklch(0.25 0.025 35);
		color: oklch(0.9 0.055 35);
	}
	.applied-row button:focus-visible,
	.motion-search-clear:focus-visible,
	.compatibility-filter:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 2px;
	}
	.mode-control {
		display: grid;
		grid-template-columns: 1fr 1fr;
		margin-top: 0.6rem;
		border: 1px solid oklch(0.29 0.018 58);
		border-radius: 0.4rem;
		padding: 0.15rem;
		background: oklch(0.175 0.012 55);
	}
	.mode-control button {
		min-height: 1.75rem;
		border: 0;
		border-radius: 0.28rem;
		background: transparent;
		color: oklch(0.65 0.018 65);
		font-size: 0.625rem;
		font-weight: 600;
		cursor: pointer;
	}
	.mode-control button.active {
		background: oklch(0.29 0.035 55);
		color: oklch(0.95 0.014 70);
		box-shadow: 0 1px 2px oklch(0.08 0.01 55 / 0.45);
	}
	.mode-control button:focus-visible,
	.preset-tile:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 2px;
	}
	.generator-controls {
		display: grid;
		gap: 0.45rem;
		margin-top: 0.65rem;
		border: 1px solid oklch(0.255 0.016 55);
		border-radius: 0.45rem;
		padding: 0.55rem;
		background: oklch(0.17 0.01 55 / 0.7);
	}
	.generator-controls label {
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: center;
		column-gap: 0.5rem;
		font-size: 0.6rem;
		color: oklch(0.76 0.018 65);
	}
	.generator-controls output {
		min-width: 2.4rem;
		font-variant-numeric: tabular-nums;
		text-align: right;
		color: oklch(0.68 0.11 45);
	}
	.generator-controls label :global([data-orientation='horizontal']) {
		grid-column: 1 / -1;
	}
	.preset-library {
		display: grid;
		gap: 0.8rem;
		margin-top: 0.8rem;
	}
	.live-library {
		margin-top: 0.9rem;
		border-top: 1px solid oklch(0.25 0.015 55);
		padding-top: 0.75rem;
	}
	.live-heading {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.5rem;
	}
	.live-heading h3 {
		font-size: 0.65rem;
		font-weight: 700;
		color: oklch(0.86 0.02 65);
	}
	.live-heading p {
		margin-top: 0.15rem;
		font-size: 0.5625rem;
		line-height: 1.35;
		color: oklch(0.64 0.018 65);
	}
	.live-heading > span,
	.active-dot {
		border-radius: 999px;
		background: oklch(0.62 0.12 230 / 0.14);
		padding: 0.12rem 0.35rem;
		font-size: 0.5rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: oklch(0.75 0.11 230);
	}
	.live-grid {
		grid-template-columns: repeat(5, minmax(0, 1fr));
	}
	.live-tile {
		position: relative;
		min-height: 4.6rem;
		padding-inline: 0.2rem;
	}
	.live-tile.active {
		border-color: oklch(0.55 0.1 230);
		background: oklch(0.23 0.035 225);
		color: oklch(0.91 0.025 225);
	}
	.active-dot {
		position: absolute;
		top: 0.18rem;
		right: 0.18rem;
		width: 0.35rem;
		height: 0.35rem;
		overflow: hidden;
		padding: 0;
		color: transparent;
	}
	.live-editor {
		margin-top: 0.45rem;
		border: 1px solid oklch(0.29 0.03 225);
		border-radius: 0.45rem;
		padding: 0.5rem;
		background: oklch(0.17 0.018 225 / 0.7);
	}
	.live-editor-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.625rem;
		color: oklch(0.83 0.025 225);
	}
	.live-editor-heading button {
		border: 0;
		background: transparent;
		color: oklch(0.68 0.055 38);
		font-size: 0.5625rem;
		cursor: pointer;
	}
	.live-editor-heading button:hover {
		color: oklch(0.82 0.11 38);
	}
	.live-controls {
		margin-top: 0.45rem;
		border: 0;
		padding: 0;
		background: transparent;
	}
	.motion-utility {
		display: grid;
		gap: 0.5rem;
		margin-top: 0.65rem;
		border: 1px solid oklch(0.3 0.035 225);
		border-radius: 0.45rem;
		padding: 0.55rem;
		background: oklch(0.18 0.02 225 / 0.72);
	}
	.motion-utility strong {
		font-size: 0.625rem;
		color: oklch(0.87 0.025 225);
	}
	.motion-utility p {
		margin-top: 0.14rem;
		font-size: 0.5625rem;
		line-height: 1.4;
		color: oklch(0.66 0.025 225);
	}
	.motion-utility button {
		min-height: 1.8rem;
		border-radius: 0.34rem;
		padding: 0.3rem 0.55rem;
		font-size: 0.6rem;
		font-weight: 700;
		cursor: pointer;
	}
	.motion-utility button.primary {
		border: 1px solid oklch(0.56 0.12 45);
		background: oklch(0.57 0.13 45);
		color: oklch(0.99 0.006 70);
	}
	.motion-utility button.secondary {
		border: 1px solid oklch(0.34 0.025 60);
		background: oklch(0.21 0.015 58);
		color: oklch(0.77 0.02 65);
	}
	.motion-utility button:hover {
		filter: brightness(1.1);
	}
	.motion-utility button:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 2px;
	}
	.confirmation {
		display: grid;
		gap: 0.45rem;
		border-top: 1px solid oklch(0.29 0.025 225);
		padding-top: 0.5rem;
	}
	.confirmation > div {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.4rem;
	}
	.trim-utility {
		margin-top: 0.75rem;
		border-color: oklch(0.3 0.025 58);
		background: oklch(0.18 0.014 58 / 0.72);
	}
	.trim-utility strong {
		color: oklch(0.84 0.02 68);
	}
	.trim-utility p {
		color: oklch(0.65 0.018 65);
	}
	.preset-group h3 {
		margin-bottom: 0.4rem;
		font-size: 0.5625rem;
		font-weight: 700;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: oklch(0.64 0.02 65);
	}
	.preset-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.35rem;
	}
	.preset-tile {
		display: flex;
		min-width: 0;
		min-height: 4.15rem;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		border: 1px solid oklch(0.27 0.016 55);
		border-radius: 0.4rem;
		padding: 0.35rem;
		background: oklch(0.18 0.012 55);
		color: oklch(0.7 0.018 65);
		font-size: 0.55rem;
		line-height: 1.15;
		text-align: center;
		cursor: pointer;
		transition:
			border-color 120ms ease,
			background 120ms ease,
			color 120ms ease;
	}
	.preset-tile:hover:not(:disabled),
	.preset-tile:focus-visible {
		border-color: oklch(0.48 0.065 50);
		background: oklch(0.225 0.022 52);
		color: oklch(0.95 0.014 70);
	}
	.preset-tile:disabled {
		cursor: not-allowed;
		opacity: 0.42;
	}
	.thumbnail {
		position: relative;
		display: grid;
		width: 2.25rem;
		height: 1.65rem;
		place-items: center;
		overflow: hidden;
		border-radius: 0.28rem;
		background: oklch(0.135 0.012 55);
	}
	.motion-origin {
		position: absolute;
		width: 0.25rem;
		height: 0.25rem;
		border: 1px solid oklch(0.58 0.035 58);
		border-radius: 50%;
		opacity: 0.55;
	}
	.motion-glyph {
		position: relative;
		z-index: 1;
		width: 0.8rem;
		height: 0.8rem;
		border-radius: 0.18rem;
		background: oklch(0.68 0.15 45);
		box-shadow: 0 0 0 1px oklch(0.84 0.09 55 / 0.22);
	}
	.preset-tile[data-kind='fade']:hover .motion-glyph,
	.preset-tile[data-kind='fade']:focus-visible .motion-glyph {
		animation: ve-motion-fade 700ms ease-in-out infinite alternate;
	}
	.preset-tile[data-kind='slide'][data-angle='0']:hover .motion-glyph,
	.preset-tile[data-kind='slide'][data-angle='0']:focus-visible .motion-glyph {
		animation: ve-motion-slide-right 700ms cubic-bezier(0.16, 1, 0.3, 1) infinite;
	}
	.preset-tile[data-kind='slide'][data-angle='180']:hover .motion-glyph,
	.preset-tile[data-kind='slide'][data-angle='180']:focus-visible .motion-glyph {
		animation: ve-motion-slide-left 700ms cubic-bezier(0.16, 1, 0.3, 1) infinite;
	}
	.preset-tile[data-kind='slide'][data-angle='90']:hover .motion-glyph,
	.preset-tile[data-kind='slide'][data-angle='90']:focus-visible .motion-glyph {
		animation: ve-motion-slide-down 700ms cubic-bezier(0.16, 1, 0.3, 1) infinite;
	}
	.preset-tile[data-kind='slide'][data-angle='270']:hover .motion-glyph,
	.preset-tile[data-kind='slide'][data-angle='270']:focus-visible .motion-glyph {
		animation: ve-motion-slide-up 700ms cubic-bezier(0.16, 1, 0.3, 1) infinite;
	}
	.preset-tile[data-kind='scale']:hover .motion-glyph,
	.preset-tile[data-kind='scale']:focus-visible .motion-glyph,
	.preset-tile[data-kind='pulse']:hover .motion-glyph,
	.preset-tile[data-kind='pulse']:focus-visible .motion-glyph {
		animation: ve-motion-scale 650ms cubic-bezier(0.34, 1.56, 0.64, 1) infinite alternate;
	}
	.preset-tile[data-kind='spin']:hover .motion-glyph,
	.preset-tile[data-kind='spin']:focus-visible .motion-glyph {
		animation: ve-motion-spin 750ms cubic-bezier(0.16, 1, 0.3, 1) infinite;
	}
	.preset-tile[data-kind='bounce']:hover .motion-glyph,
	.preset-tile[data-kind='bounce']:focus-visible .motion-glyph {
		animation: ve-motion-bounce 650ms cubic-bezier(0.2, 1.5, 0.4, 1) infinite;
	}
	.preset-tile[data-kind='shake']:hover .motion-glyph,
	.preset-tile[data-kind='shake']:focus-visible .motion-glyph {
		animation: ve-motion-shake 430ms ease-in-out infinite;
	}
	.preset-tile[data-kind='wobble']:hover .motion-glyph,
	.preset-tile[data-kind='wobble']:focus-visible .motion-glyph {
		animation: ve-motion-wobble 620ms ease-in-out infinite;
	}
	.preset-tile[data-kind='drift']:hover .motion-glyph,
	.preset-tile[data-kind='drift']:focus-visible .motion-glyph {
		animation: ve-motion-drift 1.4s ease-in-out infinite;
	}
	.preset-tile[data-kind='micro-shake']:hover .motion-glyph,
	.preset-tile[data-kind='micro-shake']:focus-visible .motion-glyph {
		animation: ve-motion-micro-shake 180ms steps(2, jump-none) infinite;
	}
	.preset-tile-wrap {
		display: grid;
		gap: 0.25rem;
	}
	.layer-add-btn {
		min-height: 1.5rem;
		border: 1px solid oklch(0.32 0.04 240);
		border-radius: 0.32rem;
		background: oklch(0.22 0.02 240);
		color: oklch(0.84 0.04 240);
		font-size: 0.5rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		cursor: pointer;
	}
	.layer-add-btn:hover:not(:disabled) {
		background: oklch(0.28 0.03 240);
		color: oklch(0.95 0.02 240);
	}
	.layer-add-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.layer-add-btn:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 2px;
	}
	@media (max-width: 640px) {
		.layer-add-btn,
		.applied-row,
		.applied-row > label,
		.applied-row button,
		.motion-clip-card button,
		.compatibility-filter {
			min-height: 2.75rem;
		}
	}
	@media (max-width: 360px) {
		.preset-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.live-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	.motion-status {
		min-height: 0.9rem;
		color: oklch(0.76 0.055 58);
	}
	.motion-no-results {
		margin-top: 0.75rem;
		border: 1px dashed oklch(0.3 0.018 55);
		border-radius: 0.4rem;
		padding: 0.65rem;
		text-align: center;
		font-size: 0.6rem;
		color: oklch(0.62 0.018 65);
	}
	@keyframes ve-motion-fade {
		from {
			opacity: 0.18;
		}
		to {
			opacity: 1;
		}
	}
	@keyframes ve-motion-slide-right {
		from {
			transform: translateX(-0.75rem);
			opacity: 0;
		}
		to {
			transform: translateX(0);
			opacity: 1;
		}
	}
	@keyframes ve-motion-slide-left {
		from {
			transform: translateX(0.75rem);
			opacity: 0;
		}
		to {
			transform: translateX(0);
			opacity: 1;
		}
	}
	@keyframes ve-motion-slide-down {
		from {
			transform: translateY(-0.5rem);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}
	@keyframes ve-motion-slide-up {
		from {
			transform: translateY(0.5rem);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}
	@keyframes ve-motion-scale {
		from {
			transform: scale(0.62);
			opacity: 0.45;
		}
		to {
			transform: scale(1.12);
			opacity: 1;
		}
	}
	@keyframes ve-motion-spin {
		from {
			transform: rotate(-180deg) scale(0.7);
			opacity: 0;
		}
		to {
			transform: rotate(0) scale(1);
			opacity: 1;
		}
	}
	@keyframes ve-motion-bounce {
		0% {
			transform: translateY(-0.5rem);
			opacity: 0;
		}
		72% {
			transform: translateY(0.12rem);
			opacity: 1;
		}
		100% {
			transform: translateY(0);
			opacity: 1;
		}
	}
	@keyframes ve-motion-shake {
		0%,
		100% {
			transform: translateX(0);
		}
		25% {
			transform: translateX(0.3rem);
		}
		75% {
			transform: translateX(-0.3rem);
		}
	}
	@keyframes ve-motion-wobble {
		0%,
		100% {
			transform: rotate(0);
		}
		30% {
			transform: rotate(10deg);
		}
		65% {
			transform: rotate(-8deg);
		}
	}
	@keyframes ve-motion-drift {
		0%,
		100% {
			transform: translate(-0.35rem, 0.2rem) rotate(-3deg);
		}
		50% {
			transform: translate(0.4rem, -0.25rem) rotate(3deg);
		}
	}
	@keyframes ve-motion-micro-shake {
		0%,
		100% {
			transform: translate(-0.1rem, 0.08rem) rotate(-1deg);
		}
		50% {
			transform: translate(0.12rem, -0.1rem) rotate(1deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.preset-tile,
		.motion-glyph {
			animation: none !important;
			transition: none !important;
		}
	}
</style>
