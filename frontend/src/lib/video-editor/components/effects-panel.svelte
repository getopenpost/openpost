<!--
	Effects panel: per-clip effect stack — CSS-filter color/blur effects plus
	the GPU catalog (WebGL2 pipeline), and the clip's compositing blend mode.
	Sliders draft locally and commit one undoable update on release.
-->
<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { Input } from '$lib/components/ui/input';
	import { Slider } from '$lib/components/ui/slider';
	import AppSelect from '$lib/components/app-select.svelte';
	import GripVerticalIcon from '@lucide/svelte/icons/grip-vertical';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import EyeOffIcon from '@lucide/svelte/icons/eye-off';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import SaveIcon from '@lucide/svelte/icons/save';
	import XIcon from '@lucide/svelte/icons/x';
	import CrosshairIcon from '@lucide/svelte/icons/crosshair';
	import {
		EFFECT_DEFINITIONS,
		type GpuEffect,
		type ItemEffect,
		type ItemType
	} from '$lib/video-editor/effects/types';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { autoKeyframeStore } from '$lib/video-editor/timeline/stores/auto-keyframe-store.svelte';
	import {
		addEffectTemplates,
		getCompatibleGpuEffectIds,
		isEffectAtDefaults,
		moveEffectOnItems,
		removeEffectOnItems,
		resetEffectOnItems,
		setEffectEnabledOnItems,
		setGpuEffectParam,
		setGpuEffectData,
		setGpuEffectDataOnItems,
		setItemBlendMode,
		updateEffect
	} from '$lib/video-editor/timeline/actions/effects';
	import {
		getGpuCategoriesWithEffects,
		getGpuEffect
	} from '$lib/video-editor/effects/gpu/registry';
	import { gpuEffectLabel } from '$lib/video-editor/effects/gpu/i18n';
	import {
		BLEND_MODE_GROUPS,
		ALL_BLEND_MODES,
		type BlendMode
	} from '$lib/video-editor/effects/gpu/blend-modes';
	import ColorScopes from './color-scopes.svelte';
	import ColorWorkspace from './color-workspace.svelte';
	import GpuCurvesEditor from './gpu-curves-editor.svelte';
	import GpuParamControl from './gpu-param-control.svelte';
	import EffectPicker, { type EffectPickerOption } from './effect-picker.svelte';
	import type { GpuParamValue } from '$lib/video-editor/effects/gpu/types';
	import {
		clearEffectDragData,
		setEffectDragData,
		type EffectDragData,
		type EffectTemplate
	} from '$lib/video-editor/timeline/effect-drop';
	import {
		BUILT_IN_EFFECT_PRESETS,
		effectTemplatesFromItems,
		loadEffectPresets,
		persistEffectPresets,
		removeEffectPreset,
		saveEffectPreset,
		type EffectPreset
	} from '$lib/video-editor/effects/effect-presets';
	import {
		removeKeyframe,
		setAnimatedProperty,
		setKeyframe
	} from '$lib/video-editor/timeline/actions/keyframes';
	import {
		effectKeyframeValue,
		getGpuEffectKeyframeProperty,
		resolveAnimatedEffectsAt
	} from '$lib/video-editor/effects/effect-keyframes';
	import { colorPreviewStore } from '$lib/video-editor/effects/color-preview-store.svelte';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import { emitEditorSound } from '$lib/video-editor/sounds/editor-sounds';
	import { getSpatialPointEffectConfig } from '$lib/video-editor/effects/spatial-point-editor';
	import { spatialEffectEditorStore } from '$lib/video-editor/preview/spatial-effect-editor.svelte';

	let {
		itemId,
		itemIds = [],
		onedit,
		showColorTools = true,
		showScopes = true
	}: {
		itemId: string | null;
		itemIds?: string[];
		onedit: () => void;
		showColorTools?: boolean;
		showScopes?: boolean;
	} = $props();

	const item = $derived(itemId ? timelineStore.itemById.get(itemId) : undefined);
	const effects = $derived(item?.effects ?? []);
	const resolvedEffects = $derived(
		item ? (resolveAnimatedEffectsAt(item, timelineStore.currentFrame) ?? []) : []
	);
	const selectedEffectItemIds = $derived(
		itemId ? [...new Set([itemId, ...itemIds])].filter(Boolean) : []
	);

	/** In-flight slider values so dragging stays smooth before the undoable commit. */
	let draftAmounts = $state<Record<string, number>>({});
	let pendingKind = $state<string>('brightness');
	let userPresets = $state<EffectPreset[]>([]);
	let presetName = $state('');
	let showPresetSave = $state(false);
	let presetStatus = $state('');
	let suppressAddAfterDrag = false;
	let dragResetTimer: ReturnType<typeof setTimeout> | null = null;

	const typeLabels = $derived<Record<Exclude<ItemType, 'gpu'>, string>>({
		brightness: m.video_editor_effects_brightness(),
		contrast: m.video_editor_effects_contrast(),
		saturation: m.video_editor_effects_saturation(),
		'hue-rotate': m.video_editor_effects_hue_rotate(),
		sepia: m.video_editor_effects_sepia(),
		grayscale: m.video_editor_effects_grayscale(),
		invert: m.video_editor_effects_invert(),
		blur: m.video_editor_effects_blur()
	});

	const gpuCategories = $derived(getGpuCategoriesWithEffects());
	const gpuCategoryLabels = $derived<Record<string, string>>({
		color: m.video_editor_gpu_category_color(),
		blur: m.video_editor_gpu_category_blur(),
		distort: m.video_editor_gpu_category_distort(),
		stylize: m.video_editor_gpu_category_stylize(),
		keying: m.video_editor_gpu_category_keying()
	});
	const builtInPresetLabels = $derived<Record<string, string>>({
		'trigger-wave-layer': m.video_editor_effect_preset_trigger_wave_layer(),
		crt: m.video_editor_effect_preset_crt(),
		'retro-tv': m.video_editor_effect_preset_retro_tv(),
		vintage: m.video_editor_effect_preset_vintage(),
		noir: m.video_editor_effect_preset_noir(),
		cold: m.video_editor_effect_preset_cold(),
		warm: m.video_editor_effect_preset_warm(),
		dramatic: m.video_editor_effect_preset_dramatic(),
		faded: m.video_editor_effect_preset_faded()
	});

	const blendModeLabels = $derived<Record<BlendMode, string>>({
		normal: m.video_editor_blend_normal(),
		dissolve: m.video_editor_blend_dissolve(),
		darken: m.video_editor_blend_darken(),
		multiply: m.video_editor_blend_multiply(),
		'color-burn': m.video_editor_blend_color_burn(),
		'linear-burn': m.video_editor_blend_linear_burn(),
		lighten: m.video_editor_blend_lighten(),
		screen: m.video_editor_blend_screen(),
		'color-dodge': m.video_editor_blend_color_dodge(),
		'linear-dodge': m.video_editor_blend_linear_dodge(),
		overlay: m.video_editor_blend_overlay(),
		'soft-light': m.video_editor_blend_soft_light(),
		'hard-light': m.video_editor_blend_hard_light(),
		'vivid-light': m.video_editor_blend_vivid_light(),
		'linear-light': m.video_editor_blend_linear_light(),
		'pin-light': m.video_editor_blend_pin_light(),
		'hard-mix': m.video_editor_blend_hard_mix(),
		difference: m.video_editor_blend_difference(),
		exclusion: m.video_editor_blend_exclusion(),
		subtract: m.video_editor_blend_subtract(),
		divide: m.video_editor_blend_divide(),
		hue: m.video_editor_blend_hue(),
		saturation: m.video_editor_blend_saturation(),
		color: m.video_editor_blend_color(),
		luminosity: m.video_editor_blend_luminosity()
	});

	const blendGroupLabels = $derived<Record<string, string>>({
		normal: m.video_editor_blend_group_normal(),
		darken: m.video_editor_blend_group_darken(),
		lighten: m.video_editor_blend_group_lighten(),
		contrast: m.video_editor_blend_group_contrast(),
		inversion: m.video_editor_blend_group_inversion(),
		component: m.video_editor_blend_group_component()
	});
	const effectOptions = $derived<EffectPickerOption[]>([
		...EFFECT_DEFINITIONS.map((definition) => ({
			value: definition.type,
			label: typeLabels[definition.type],
			group: m.video_editor_effects_basic(),
			cssEffect: definition.type,
			cssAmount: definition.defaultAmount
		})),
		...gpuCategories.flatMap((group) =>
			group.effects.map((definition) => ({
				value: `gpu:${definition.id}`,
				label: gpuEffectLabel(definition),
				group: gpuCategoryLabels[group.category],
				gpuEffectId: definition.id
			}))
		),
		...BUILT_IN_EFFECT_PRESETS.map((preset) => ({
			value: `preset:${preset.id}`,
			label: builtInPresetLabels[preset.id] ?? preset.name,
			group: m.video_editor_effects_presets(),
			previewEffects: preset.effects
		})),
		...userPresets.map((preset) => ({
			value: `user-preset:${preset.id}`,
			label: preset.name,
			group: m.video_editor_effects_my_presets(),
			previewEffects: preset.effects,
			removable: true
		}))
	]);
	const blendOptions = $derived(
		BLEND_MODE_GROUPS.flatMap((group) =>
			group.modes.map((mode) => ({
				value: mode,
				label: `${blendGroupLabels[group.label]}: ${blendModeLabels[mode]}`
			}))
		)
	);

	function definitionFor(type: string) {
		return EFFECT_DEFINITIONS.find((entry) => entry.type === type);
	}

	function handleAdd(): void {
		if (suppressAddAfterDrag) {
			suppressAddAfterDrag = false;
			return;
		}
		const templates = pendingEffectTemplates();
		if (templates.length > 0 && addEffectTemplates(selectedEffectItemIds, templates)) onedit();
	}

	function pendingEffectTemplates(): EffectTemplate[] {
		if (pendingKind.startsWith('gpu:')) {
			const effectId = pendingKind.slice(4);
			return getGpuEffect(effectId) ? [{ kind: 'gpu', effectId }] : [];
		}
		if (pendingKind.startsWith('preset:')) {
			return (
				BUILT_IN_EFFECT_PRESETS.find((preset) => preset.id === pendingKind.slice(7))?.effects ?? []
			).map(cloneTemplate);
		}
		if (pendingKind.startsWith('user-preset:')) {
			return (userPresets.find((preset) => preset.id === pendingKind.slice(12))?.effects ?? []).map(
				cloneTemplate
			);
		}
		const definition = definitionFor(pendingKind);
		return definition ? [{ kind: 'css', effectType: definition.type }] : [];
	}

	function pendingEffectLabel(): string {
		return effectOptions.find((option) => option.value === pendingKind)?.label ?? pendingKind;
	}

	function startEffectDrag(event: DragEvent): void {
		const templates = pendingEffectTemplates();
		if (templates.length === 0 || !event.dataTransfer) {
			event.preventDefault();
			return;
		}
		const payload: EffectDragData = {
			type: 'timeline-effect',
			label: pendingEffectLabel(),
			effects: templates
		};
		suppressAddAfterDrag = true;
		event.dataTransfer.effectAllowed = 'copy';
		event.dataTransfer.setData('application/json', JSON.stringify(payload));
		setEffectDragData(payload);
	}

	function cloneTemplate(template: EffectTemplate): EffectTemplate {
		return template.kind === 'gpu'
			? { ...template, params: template.params ? { ...template.params } : undefined }
			: { ...template };
	}

	function saveCurrentPreset(): void {
		const next = saveEffectPreset(userPresets, presetName, effectTemplatesFromItems(effects));
		const saved = next.find(
			(preset) => preset.name.toLocaleLowerCase() === presetName.trim().toLocaleLowerCase()
		);
		if (!saved) return;
		if (!persistEffectPresets(next)) {
			presetStatus = m.video_editor_effects_preset_save_failed();
			return;
		}
		userPresets = next;
		pendingKind = `user-preset:${saved.id}`;
		presetStatus = m.video_editor_effects_preset_saved({ name: saved.name });
		presetName = '';
		showPresetSave = false;
	}

	function deleteUserPreset(value: string): void {
		if (!value.startsWith('user-preset:')) return;
		const presetId = value.slice(12);
		const preset = userPresets.find((entry) => entry.id === presetId);
		if (!preset) return;
		const next = removeEffectPreset(userPresets, presetId);
		if (!persistEffectPresets(next)) {
			presetStatus = m.video_editor_effects_preset_delete_failed();
			return;
		}
		userPresets = next;
		if (pendingKind === value) pendingKind = 'brightness';
		presetStatus = m.video_editor_effects_preset_deleted({ name: preset.name });
	}

	onMount(() => {
		userPresets = loadEffectPresets();
	});

	function finishEffectDrag(): void {
		clearEffectDragData();
		if (dragResetTimer) clearTimeout(dragResetTimer);
		dragResetTimer = setTimeout(() => {
			suppressAddAfterDrag = false;
			dragResetTimer = null;
		}, 0);
	}

	onDestroy(() => {
		clearEffectDragData();
		if (itemId) colorPreviewStore.clearEffectDraft(itemId);
		if (spatialEffectEditorStore.editingItemId === itemId) stopSpatialEditing();
		if (dragResetTimer) clearTimeout(dragResetTimer);
	});

	function commitAmount(effectId: string, amount: number): void {
		if (!itemId) return;
		if (updateEffect(itemId, effectId, { amount })) onedit();
		delete draftAmounts[effectId];
	}

	function resolvedGpuEffect(effect: GpuEffect): GpuEffect {
		const resolved = resolvedEffects.find((candidate) => candidate.id === effect.id);
		return resolved?.type === 'gpu' ? resolved : effect;
	}

	function effectRelativeFrame(): number | null {
		if (
			!item ||
			timelineStore.currentFrame < item.from ||
			timelineStore.currentFrame >= item.from + item.durationInFrames
		) {
			return null;
		}
		return timelineStore.currentFrame - item.from;
	}

	function commitGpuParam(effect: GpuEffect, paramName: string, value: GpuParamValue): void {
		if (!itemId || !item) return;
		const property = getGpuEffectKeyframeProperty(effect, paramName);
		const encoded = property ? effectKeyframeValue(effect, paramName, value) : null;
		const updated =
			property && encoded !== null && effectRelativeFrame() !== null
				? setAnimatedProperty(
						itemId,
						property,
						timelineStore.currentFrame,
						encoded,
						autoKeyframeStore.isEnabled(itemId, property)
					)
				: setGpuEffectParam(itemId, effect.id, paramName, value);
		if (updated) onedit();
	}

	function draftCurveParams(effect: GpuEffect, params: Record<string, GpuParamValue> | null): void {
		if (!itemId) return;
		if (params) {
			colorPreviewStore.setEffectDraft(
				itemId,
				effect,
				params,
				getCompatibleGpuEffectIds(itemId, selectedEffectItemIds, effect.id)
			);
		} else colorPreviewStore.clearEffectDraft(itemId, effect.id);
	}

	function commitCurveParams(effect: GpuEffect, params: Record<string, GpuParamValue>): void {
		if (!itemId) return;
		colorPreviewStore.clearEffectDraft(itemId, effect.id);
		if (setGpuEffectDataOnItems(itemId, selectedEffectItemIds, effect.id, params)) onedit();
	}

	function toggleEffectKeyframe(effect: GpuEffect, paramName: string): void {
		if (!itemId || !item) return;
		const property = getGpuEffectKeyframeProperty(effect, paramName);
		const relativeFrame = effectRelativeFrame();
		if (!property || relativeFrame === null) return;
		const track = item.keyframes?.[property];
		if (track?.frames.includes(relativeFrame)) {
			if (removeKeyframe(itemId, property, relativeFrame)) onedit();
			return;
		}
		const resolved = resolvedGpuEffect(effect);
		const encoded = effectKeyframeValue(
			effect,
			paramName,
			resolved.params[paramName] ?? effect.params[paramName] ?? 0
		);
		if (encoded !== null && setKeyframe(itemId, property, relativeFrame, encoded)) onedit();
	}

	function effectKeyframeControl(effect: GpuEffect, paramName: string) {
		if (!itemId || !item) return undefined;
		const property = getGpuEffectKeyframeProperty(effect, paramName);
		if (!property) return undefined;
		const relativeFrame = effectRelativeFrame();
		const track = item.keyframes?.[property];
		return {
			autoEnabled: autoKeyframeStore.isEnabled(itemId, property),
			hasTrack: Boolean(track?.frames.length),
			atCurrentFrame: relativeFrame !== null && Boolean(track?.frames.includes(relativeFrame)),
			canKeyframe: relativeFrame !== null,
			onToggleAuto: () => autoKeyframeStore.toggle(itemId, property),
			onToggleKeyframe: () => toggleEffectKeyframe(effect, paramName)
		};
	}

	async function importLut(effect: GpuEffect): Promise<void> {
		if (!itemId) return;
		const handles = await window.showOpenFilePicker?.({
			types: [{ description: '3D LUT', accept: { 'text/plain': ['.cube'] } }],
			multiple: false
		});
		if (!handles?.[0]) return;
		const file = await handles[0].getFile();
		const { parseCubeLut, encodeLutData } = await import('$lib/video-editor/effects/gpu/lut');
		const parsed = parseCubeLut(await file.text());
		if (
			setGpuEffectData(itemId, effect.id, {
				lutName: parsed.title ?? file.name.replace(/\.cube$/i, ''),
				lutSize: parsed.size,
				lutData: encodeLutData(parsed.data)
			})
		)
			onedit();
	}

	function commitBlendMode(value: string): void {
		const mode = ALL_BLEND_MODES.find((entry) => entry === value);
		if (!itemId || !mode) return;
		if (setItemBlendMode(itemId, mode)) onedit();
	}

	function effectLabel(effect: ItemEffect): string {
		if (effect.type !== 'gpu') return typeLabels[effect.type];
		const definition = getGpuEffect(effect.effectId);
		return definition ? gpuEffectLabel(definition) : effect.effectId;
	}

	function moveStackEffect(effectId: string, direction: -1 | 1): void {
		if (!itemId) return;
		if (moveEffectOnItems(itemId, selectedEffectItemIds, effectId, direction)) onedit();
	}

	function toggleStackEffect(effect: ItemEffect): void {
		if (!itemId) return;
		if (
			effect.enabled &&
			spatialEffectEditorStore.editingItemId === itemId &&
			spatialEffectEditorStore.editingEffectId === effect.id
		) {
			stopSpatialEditing();
		}
		if (setEffectEnabledOnItems(itemId, selectedEffectItemIds, effect.id, !effect.enabled)) {
			onedit();
			emitEditorSound(effect.enabled ? 'toggleOff' : 'toggleOn', editorSession.clock.isPlaying);
		}
	}

	function resetStackEffect(effectId: string): void {
		if (!itemId) return;
		if (resetEffectOnItems(itemId, selectedEffectItemIds, effectId)) onedit();
	}

	function removeStackEffect(effectId: string): void {
		if (!itemId) return;
		if (
			spatialEffectEditorStore.editingItemId === itemId &&
			spatialEffectEditorStore.editingEffectId === effectId
		) {
			stopSpatialEditing();
		}
		if (removeEffectOnItems(itemId, selectedEffectItemIds, effectId)) {
			onedit();
			emitEditorSound('delete', editorSession.clock.isPlaying);
		}
	}

	function stopSpatialEditing(): void {
		const editingItemId = spatialEffectEditorStore.editingItemId;
		const editingEffectId = spatialEffectEditorStore.editingEffectId;
		if (editingItemId && editingEffectId) {
			colorPreviewStore.clearEffectDraft(editingItemId, editingEffectId);
		}
		spatialEffectEditorStore.stopEditing();
	}

	function isSpatialEditing(effectId: string): boolean {
		return (
			spatialEffectEditorStore.isEditing &&
			spatialEffectEditorStore.editingItemId === itemId &&
			spatialEffectEditorStore.editingEffectId === effectId
		);
	}

	function toggleSpatialEditing(effect: GpuEffect): void {
		if (!itemId || !effect.enabled || selectedEffectItemIds.length !== 1) return;
		if (isSpatialEditing(effect.id)) {
			stopSpatialEditing();
			return;
		}
		stopSpatialEditing();
		colorPreviewStore.cancelPick();
		spatialEffectEditorStore.startEditing(itemId, effect.id);
	}

	$effect(() => {
		if (!spatialEffectEditorStore.isEditing) return;
		if (spatialEffectEditorStore.editingItemId !== itemId || selectedEffectItemIds.length !== 1) {
			stopSpatialEditing();
		}
	});
</script>

<div class="flex flex-col gap-1">
	{#if showColorTools}<ColorWorkspace {itemId} {itemIds} {onedit} />{/if}
	<h3 class="px-1 text-xs font-medium tracking-wide text-[oklch(0.65_0.015_55)] uppercase">
		{m.video_editor_effects()}
	</h3>
	<div class="flex items-center gap-1">
		<EffectPicker
			bind:value={pendingKind}
			options={effectOptions}
			ariaLabel={m.video_editor_effects_add()}
			searchPlaceholder={m.video_editor_effects_search()}
			emptyLabel={m.video_editor_effects_no_results()}
			onRemoveOption={deleteUserPreset}
			removeOptionLabel={(name) => m.video_editor_effects_preset_delete_named({ name })}
		/>
		<button
			type="button"
			class="flex items-center gap-1 rounded bg-[oklch(0.22_0.01_50)] px-2 py-1 text-xs hover:bg-[oklch(0.28_0.015_50)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] enabled:cursor-grab enabled:active:cursor-grabbing disabled:cursor-not-allowed"
			disabled={!itemId}
			draggable={itemId !== null}
			title={itemId ? m.video_editor_effects_add_or_drag() : m.video_editor_effects_add()}
			onclick={handleAdd}
			ondragstart={startEffectDrag}
			ondragend={finishEffectDrag}
		>
			<GripVerticalIcon class="size-3" />
			{m.video_editor_effects_add()}
		</button>
	</div>
	{#if showPresetSave}
		<div class="flex items-center gap-1 px-1">
			<Input
				class="h-8 min-w-0 flex-1 rounded border border-[oklch(0.32_0.015_55)] bg-[oklch(0.16_0.008_50)] px-2 text-xs"
				bind:value={presetName}
				maxlength="80"
				aria-label={m.video_editor_effects_preset_name()}
				placeholder={m.video_editor_effects_preset_name()}
				onkeydown={(event) => {
					if (event.key === 'Enter') saveCurrentPreset();
					if (event.key === 'Escape') showPresetSave = false;
				}}
			/>
			<button
				type="button"
				class="flex h-8 items-center gap-1 rounded bg-[oklch(0.62_0.13_45)] px-2 text-xs font-medium text-black hover:bg-[oklch(0.68_0.14_45)] focus-visible:outline-2 focus-visible:outline-[oklch(0.8_0.12_45)] disabled:opacity-40"
				disabled={!presetName.trim() || effects.length === 0}
				onclick={saveCurrentPreset}
			>
				<SaveIcon class="size-3" />{m.video_editor_effects_preset_save()}
			</button>
			<button
				type="button"
				class="rounded p-1.5 hover:bg-[oklch(0.28_0.015_50)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
				aria-label={m.common_cancel()}
				title={m.common_cancel()}
				onclick={() => (showPresetSave = false)}
			>
				<XIcon class="size-3" />
			</button>
		</div>
	{:else}
		<button
			type="button"
			class="mx-1 flex h-7 items-center justify-center gap-1 rounded border border-[oklch(0.3_0.015_55)] text-xs text-[oklch(0.72_0.02_55)] hover:bg-[oklch(0.24_0.012_50)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] disabled:opacity-40"
			disabled={effects.length === 0}
			aria-expanded={showPresetSave}
			onclick={() => (showPresetSave = true)}
		>
			<SaveIcon class="size-3" />{m.video_editor_effects_preset_save_current()}
		</button>
	{/if}
	{#if presetStatus}<p class="px-1 text-[10px] text-[oklch(0.7_0.02_55)]" role="status">
			{presetStatus}
		</p>{/if}
	{#if !itemId || effects.length === 0}
		<p class="px-1 text-xs text-[oklch(0.65_0.015_55)]">{m.video_editor_effects_none()}</p>
	{:else}
		<ul class="flex flex-col gap-1">
			{#each effects as effect, index (effect.id)}
				{@const definition = definitionFor(effect.type)}
				{@const gpuDefinition = effect.type === 'gpu' ? getGpuEffect(effect.effectId) : undefined}
				<li
					class="rounded bg-[oklch(0.22_0.01_50)] px-2 py-1.5"
					data-effect-id={effect.id}
					data-enabled={effect.enabled}
				>
					<div class="flex items-center justify-between gap-1">
						<span class="min-w-0 flex-1 truncate text-xs" class:opacity-55={!effect.enabled}
							>{effectLabel(effect)}</span
						>
						<div class="flex shrink-0 items-center">
							<button
								type="button"
								class="rounded p-1 hover:bg-[oklch(0.28_0.015_50)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] disabled:opacity-30"
								disabled={index === 0}
								aria-label={m.video_editor_effects_move_up()}
								title={m.video_editor_effects_move_up()}
								onclick={() => moveStackEffect(effect.id, -1)}
							>
								<ChevronUpIcon class="size-3" />
							</button>
							<button
								type="button"
								class="rounded p-1 hover:bg-[oklch(0.28_0.015_50)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] disabled:opacity-30"
								disabled={index === effects.length - 1}
								aria-label={m.video_editor_effects_move_down()}
								title={m.video_editor_effects_move_down()}
								onclick={() => moveStackEffect(effect.id, 1)}
							>
								<ChevronDownIcon class="size-3" />
							</button>
							<button
								type="button"
								class="rounded p-1 hover:bg-[oklch(0.28_0.015_50)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] disabled:opacity-30"
								disabled={isEffectAtDefaults(effect)}
								aria-label={m.video_editor_effects_reset()}
								title={m.video_editor_effects_reset()}
								onclick={() => resetStackEffect(effect.id)}
							>
								<RotateCcwIcon class="size-3" />
							</button>
							<button
								type="button"
								class="rounded p-1 hover:bg-[oklch(0.28_0.015_50)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
								aria-label={effect.enabled
									? m.video_editor_effects_disable()
									: m.video_editor_effects_enable()}
								title={effect.enabled
									? m.video_editor_effects_disable()
									: m.video_editor_effects_enable()}
								onclick={() => toggleStackEffect(effect)}
							>
								{#if effect.enabled}
									<EyeIcon class="size-3" />
								{:else}
									<EyeOffIcon class="size-3" />
								{/if}
							</button>
							<button
								type="button"
								class="rounded p-1 hover:bg-[oklch(0.28_0.015_50)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
								aria-label={m.video_editor_effects_remove()}
								title={m.video_editor_effects_remove()}
								onclick={() => removeStackEffect(effect.id)}
							>
								<Trash2Icon class="size-3" />
							</button>
						</div>
					</div>
					<div class:opacity-55={!effect.enabled}>
						{#if definition && effect.type !== 'gpu'}
							<Slider
								class="mt-1"
								min={definition.min}
								max={definition.max}
								step={definition.step}
								value={draftAmounts[effect.id] ?? effect.amount}
								ariaLabel={`${typeLabels[effect.type]} — ${m.video_editor_effects_amount()}`}
								onValueChange={(value) => {
									draftAmounts[effect.id] = value;
								}}
								onValueCommit={(value) => commitAmount(effect.id, value)}
							/>
						{/if}
						{#if gpuDefinition && effect.type === 'gpu'}
							{@const resolvedEffect = resolvedGpuEffect(effect)}
							{#if getSpatialPointEffectConfig(effect.effectId)}
								<button
									type="button"
									class="mt-1 flex h-7 w-full items-center justify-center gap-1.5 rounded border border-[oklch(0.32_0.015_55)] px-2 text-xs hover:bg-[oklch(0.28_0.015_50)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] disabled:cursor-not-allowed disabled:opacity-40 [@media(pointer:coarse)]:h-11 {isSpatialEditing(
										effect.id
									)
										? 'border-[oklch(0.66_0.14_45)] bg-[oklch(0.66_0.14_45)] text-black hover:bg-[oklch(0.72_0.14_45)]'
										: ''}"
									disabled={!effect.enabled || selectedEffectItemIds.length !== 1}
									aria-pressed={isSpatialEditing(effect.id)}
									aria-label={isSpatialEditing(effect.id)
										? m.video_editor_spatial_stop_editing({ effect: effectLabel(effect) })
										: m.video_editor_spatial_edit_center({ effect: effectLabel(effect) })}
									onclick={() => toggleSpatialEditing(effect)}
								>
									<CrosshairIcon class="size-3.5" />
									{isSpatialEditing(effect.id)
										? m.video_editor_spatial_editing_center()
										: m.video_editor_spatial_edit_center_short()}
								</button>
							{/if}
							{#if effect.effectId === 'gpu-lut'}
								<button
									type="button"
									class="mt-1 w-full rounded border border-[oklch(0.32_0.015_55)] px-2 py-1 text-xs hover:bg-[oklch(0.28_0.015_50)]"
									onclick={() => importLut(effect)}
									>{typeof effect.params.lutName === 'string'
										? effect.params.lutName
										: m.video_editor_effects_choose_lut()}</button
								>
							{/if}
							{#if effect.effectId === 'gpu-curves'}
								<GpuCurvesEditor
									gpuEffect={resolvedEffect}
									ondraft={(params) => draftCurveParams(resolvedEffect, params)}
									oncommit={(params) => commitCurveParams(effect, params)}
								/>
							{:else}
								<div class="mt-1 flex flex-col gap-1">
									{#each gpuDefinition.schema as param (param.name)}
										{#if !param.visibleWhen || param.visibleWhen(effect.params)}
											<GpuParamControl
												{param}
												value={resolvedEffect.params[param.name]}
												effectLabel={effectLabel(effect)}
												oncommit={(value) => commitGpuParam(effect, param.name, value)}
												keyframe={effectKeyframeControl(effect, param.name)}
											/>
										{/if}
									{/each}
								</div>
							{/if}
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
	{#if itemId}
		<label class="mt-1 flex items-center gap-2 px-1 text-xs">
			<span class="shrink-0 text-[oklch(0.65_0.015_55)]">{m.video_editor_blend_mode()}</span>
			<AppSelect
				class="h-8 min-w-0 flex-1 text-xs"
				value={item?.blendMode ?? 'normal'}
				options={blendOptions}
				onValueChange={commitBlendMode}
			/>
		</label>
	{/if}
</div>
{#if itemId && showScopes}<ColorScopes {itemId} />{/if}
