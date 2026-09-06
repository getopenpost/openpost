<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Input } from '$lib/components/ui/input';
	import { ThemeIcon, ProtectedIcon } from '$lib/themes/icons';
	import EditorColorComparison from '$lib/components/editor-color-comparison.svelte';
	import { m } from '$lib/paraglide/messages';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import {
		autoBalanceFromFrame,
		blackPointFromPick,
		hasEnabledColorGrade,
		luma601,
		snapshotColorGrade,
		whiteBalanceFromPick,
		whitePointFromPick,
		type GradeEffectSnapshot
	} from '$lib/video-editor/effects/color-grade';
	import {
		colorPreviewStore,
		type ColorComparisonMode,
		type ColorPickerKind
	} from '$lib/video-editor/effects/color-preview-store.svelte';
	import { scopeSamples } from '$lib/video-editor/effects/scope-samples.svelte';
	import {
		loadColorGradePresets,
		persistColorGradePresets,
		removeColorGradePreset,
		saveColorGradePreset,
		type ColorGradePreset
	} from '$lib/video-editor/effects/color-grade-presets';
	import { replaceColorGradeEffects } from '$lib/video-editor/timeline/actions/effects';
	import { setAnimatedGpuEffectParamsOnItems } from '$lib/video-editor/timeline/actions/keyframes';
	import { autoKeyframeStore } from '$lib/video-editor/timeline/stores/auto-keyframe-store.svelte';
	import { resolveAnimatedEffectsAt } from '$lib/video-editor/effects/effect-keyframes';
	import { getGpuEffectDefaultParams } from '$lib/video-editor/effects/gpu/registry';
	import {
		copyColorGradeFromItem,
		pasteColorGradeToItems
	} from '$lib/video-editor/effects/color-grade-clipboard';
	import ColorPrimaryControls from './color-primary-controls.svelte';
	import {
		EDITOR_COLOR_GRADE_PRESETS,
		editorColorGradePresetLabel,
		type EditorColorGradePresetID
	} from '$lib/editor-color-grade/presets';
	import { defaultEditorColorGradeAdjustments } from '$lib/editor-color-grade/model';
	import { editorColorGradeAdjustmentsToEffects } from '$lib/editor-color-grade/image-grade';

	let {
		itemId,
		itemIds = [],
		onedit,
		oncreateadjustment,
		autoKey = false,
		onAutoKeyChange = () => undefined
	}: {
		itemId: string | null;
		itemIds?: string[];
		onedit: () => void;
		oncreateadjustment?: () => void;
		autoKey?: boolean;
		onAutoKeyChange?: (enabled: boolean) => void;
	} = $props();
	let presets = $state<ColorGradePreset[]>([]);
	let presetName = $state('');
	let showPresetSave = $state(false);
	let status = $state('');

	const item = $derived(itemId ? timelineStore.itemById.get(itemId) : undefined);
	const grade = $derived(snapshotColorGrade(item?.effects));
	const hasGrade = $derived(hasEnabledColorGrade(item?.effects));
	const isVisual = $derived(item?.type !== 'audio' && item !== undefined);
	const targetItemIds = $derived.by(() => {
		const requested = itemId && itemIds.includes(itemId) ? itemIds : itemId ? [itemId] : [];
		return Array.from(new Set(requested)).filter(
			(id) => timelineStore.itemById.get(id)?.type !== 'audio'
		);
	});
	onMount(() => {
		presets = loadColorGradePresets();
	});

	onDestroy(() => {
		if (colorPreviewStore.activePicker?.itemId === itemId) colorPreviewStore.cancelPick();
		if (colorPreviewStore.frameCaptureItemId === itemId) colorPreviewStore.cancelFrameCapture();
	});

	$effect(() => {
		if (!hasGrade && colorPreviewStore.comparisonMode !== 'after') {
			colorPreviewStore.setComparisonMode('after');
		}
	});

	$effect(() => {
		const picker = colorPreviewStore.activePicker;
		if (picker && picker.itemId !== itemId) colorPreviewStore.cancelPick();
		const captureItemId = colorPreviewStore.frameCaptureItemId;
		if (captureItemId && captureItemId !== itemId) colorPreviewStore.cancelFrameCapture();
	});

	function readWheelParam(name: string): number {
		const defaults = getGpuEffectDefaultParams('gpu-color-wheels');
		const effect = (
			item ? resolveAnimatedEffectsAt(item, timelineStore.currentFrame) : undefined
		)?.find((entry) => entry.type === 'gpu' && entry.effectId === 'gpu-color-wheels');
		if (!effect || effect.type !== 'gpu') return Number(defaults[name] ?? 0);
		return Number(effect.params[name] ?? defaults[name] ?? 0);
	}

	function applyWheelParams(updates: Record<string, number>, message: string): void {
		if (!itemId) return;
		status = message;
		if (
			setAnimatedGpuEffectParamsOnItems(
				targetItemIds,
				'gpu-color-wheels',
				timelineStore.currentFrame,
				updates,
				(id, property) => autoKey || autoKeyframeStore.isEnabled(id, property)
			)
		)
			onedit();
	}

	async function autoBalance(): Promise<void> {
		if (!itemId) return;
		const targetItemId = itemId;
		status = m.video_editor_color_analyzing();
		const captured = await colorPreviewStore.requestFrameCapture(targetItemId);
		const fallback = scopeSamples.current;
		const image =
			captured ?? (fallback?.itemId === targetItemId ? scopeSamples.readImage(fallback) : null);
		if (!image || itemId !== targetItemId) {
			status = m.video_editor_color_sample_unavailable();
			return;
		}
		const updates = autoBalanceFromFrame(image, {
			lift: readWheelParam('lift'),
			gain: readWheelParam('gain'),
			temperature: readWheelParam('temperature'),
			tint: readWheelParam('tint')
		});
		applyWheelParams({ ...updates }, m.video_editor_color_auto_applied());
	}

	async function pick(kind: ColorPickerKind): Promise<void> {
		if (!itemId) return;
		const targetItemId = itemId;
		status = m.video_editor_color_picker_instruction();
		const picked = await colorPreviewStore.requestPick(targetItemId, kind);
		if (!picked || itemId !== targetItemId) {
			status = '';
			return;
		}
		if (kind === 'white-balance') {
			const correction = whiteBalanceFromPick(
				picked,
				readWheelParam('temperature'),
				readWheelParam('tint')
			);
			applyWheelParams({ ...correction }, m.video_editor_color_white_balance_applied());
			return;
		}
		const pickedLuma = luma601(picked);
		if (kind === 'black-point') {
			applyWheelParams(
				{ lift: blackPointFromPick(pickedLuma, readWheelParam('lift')) },
				m.video_editor_color_black_point_applied()
			);
			return;
		}
		applyWheelParams(
			{ gain: whitePointFromPick(pickedLuma, readWheelParam('gain')) },
			m.video_editor_color_white_point_applied()
		);
	}

	function setComparison(mode: ColorComparisonMode): void {
		if (mode !== 'after' && !hasGrade) return;
		colorPreviewStore.setComparisonMode(mode, targetItemIds);
	}

	function copyGrade(): void {
		if (!itemId) return;
		const result = copyColorGradeFromItem(itemId);
		if (result) status = m.video_editor_color_grade_copied({ count: result.effectCount });
	}

	function applyGrade(effects: readonly GradeEffectSnapshot[], message: string): void {
		if (!itemId || !replaceColorGradeEffects(targetItemIds, effects)) return;
		status = message;
		onedit();
	}

	function pasteGrade(): void {
		const result = pasteColorGradeToItems(targetItemIds);
		if (!result) return;
		status = m.video_editor_color_grade_pasted({ count: result.effectCount });
		onedit();
	}

	function savePreset(): void {
		const next = saveColorGradePreset(presets, presetName, grade);
		if (next.length === presets.length && next.every((entry, index) => entry === presets[index]))
			return;
		if (!persistColorGradePresets(next)) {
			status = m.video_editor_color_preset_save_failed();
			return;
		}
		presets = next;
		const saved = presets.find(
			(preset) => preset.name.toLocaleLowerCase() === presetName.trim().toLocaleLowerCase()
		);
		status = m.video_editor_color_preset_saved({ name: saved?.name ?? presetName.trim() });
		presetName = '';
		showPresetSave = false;
	}

	function applyPreset(preset: ColorGradePreset): void {
		applyGrade(preset.effects, m.video_editor_color_preset_applied({ name: preset.name }));
	}

	function applyBuiltinPreset(id: EditorColorGradePresetID): void {
		const preset = EDITOR_COLOR_GRADE_PRESETS.find((candidate) => candidate.id === id);
		if (!preset) return;
		const name = editorColorGradePresetLabel(id);
		const effects = editorColorGradeAdjustmentsToEffects({
			...defaultEditorColorGradeAdjustments(),
			...preset.adjustments
		}).map((effect) => ({ ...effect, enabled: true }));
		applyGrade(effects, m.video_editor_color_preset_applied({ name }));
	}

	function deletePreset(preset: ColorGradePreset): void {
		const next = removeColorGradePreset(presets, preset.id);
		if (!persistColorGradePresets(next)) {
			status = m.video_editor_color_preset_delete_failed();
			return;
		}
		presets = next;
		status = m.video_editor_color_preset_deleted({ name: preset.name });
	}
</script>

{#if isVisual}
	<section
		class="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--video-editor-panel)]"
		aria-label={m.video_editor_color_workspace()}
	>
		<div class="shrink-0 border-b border-[var(--video-editor-border)] px-2 py-1.5">
			<div class="flex items-center justify-between gap-2">
				<div class="flex items-center gap-1">
					<h3
						class="text-xs font-semibold tracking-wide text-[var(--video-editor-muted)] uppercase"
					>
						{m.video_editor_color_workspace()}
					</h3>
					<button
						type="button"
						class="color-tool h-7 [@media(pointer:coarse)]:h-11"
						class:bg-[var(--video-editor-primary)]={autoKey}
						class:text-[var(--video-editor-primary-text)]={autoKey}
						aria-pressed={autoKey}
						title={m.video_editor_shortcuts_command_keyframe_auto()}
						onclick={() => onAutoKeyChange(!autoKey)}
					>
						<span class="size-1.5 rounded-full bg-current" aria-hidden="true"></span>
						{m.video_editor_shortcuts_command_keyframe_auto()}
					</button>
				</div>
				<EditorColorComparison
					mode={colorPreviewStore.comparisonMode}
					disabled={!hasGrade}
					showSplit
					splitPosition={colorPreviewStore.splitPosition}
					ariaLabel={m.video_editor_color_compare_mode()}
					afterLabel={m.video_editor_color_after()}
					beforeLabel={m.video_editor_color_before()}
					splitLabel={m.video_editor_color_split()}
					splitPositionLabel={m.video_editor_color_split_position()}
					onmodechange={setComparison}
					onsplitpositionchange={(value) => colorPreviewStore.setSplitPosition(value)}
				/>
			</div>

			<div
				class="mt-1 flex flex-wrap gap-1"
				role="group"
				aria-label={m.video_editor_color_balance()}
			>
				<button
					type="button"
					class="color-tool min-w-24 flex-1"
					disabled={grade.length === 0}
					onclick={copyGrade}
				>
					<ThemeIcon role="copy" class="size-3.5" />{m.video_editor_color_copy_grade()}
				</button>
				<button
					type="button"
					class="color-tool min-w-24 flex-1"
					disabled={!colorPreviewStore.gradeClipboard?.length}
					onclick={pasteGrade}
				>
					<ThemeIcon role="copy" class="size-3.5" />{m.video_editor_color_paste_grade()}
				</button>
				{#if oncreateadjustment}
					<button
						type="button"
						class="color-tool min-w-28 flex-1"
						title={m.video_editor_adjustment_layer_hint()}
						onclick={oncreateadjustment}
					>
						<ProtectedIcon
							icon="editor-layers"
							class="size-3.5"
						/>{m.video_editor_adjustment_layer()}
					</button>
				{/if}
				<button
					type="button"
					class="color-icon"
					disabled={grade.length === 0}
					title={m.video_editor_color_presets()}
					aria-label={m.video_editor_color_presets()}
					aria-expanded={showPresetSave}
					onclick={() => (showPresetSave = !showPresetSave)}
				>
					<ThemeIcon role="save" class="size-3.5" />
				</button>
			</div>
			{#if showPresetSave}
				<div class="mt-1 grid grid-cols-[1fr_auto] gap-1">
					<Input
						class="h-7 min-w-0 rounded border border-[var(--video-editor-border)] bg-[var(--video-editor-panel)] px-2 text-xs"
						bind:value={presetName}
						placeholder={m.video_editor_color_preset_name()}
						aria-label={m.video_editor_color_preset_name()}
						onkeydown={(event) => {
							if (event.key === 'Enter') savePreset();
							if (event.key === 'Escape') showPresetSave = false;
						}}
					/>
					<button
						type="button"
						class="color-icon"
						disabled={!presetName.trim() || grade.length === 0}
						title={m.video_editor_color_save_preset()}
						aria-label={m.video_editor_color_save_preset()}
						onclick={savePreset}
					>
						<ThemeIcon role="save" class="size-3.5" />
					</button>
				</div>
			{/if}
			<div class="mt-1" aria-label={m.video_editor_color_presets()}>
				<div class="mb-1 text-[9px] tracking-wide text-[var(--video-editor-muted)] uppercase">
					{m.video_editor_color_presets()}
				</div>
				<div class="flex gap-1 overflow-x-auto pb-1">
					{#each EDITOR_COLOR_GRADE_PRESETS as preset (preset.id)}
						<button
							type="button"
							class="flex h-11 min-w-20 flex-col items-start justify-between rounded-sm border border-[var(--video-editor-border)] bg-[var(--video-editor-control-hover)] px-2 py-1 text-left hover:bg-[var(--video-editor-control-hover)] focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)]"
							title={editorColorGradePresetLabel(preset.id)}
							onclick={() => applyBuiltinPreset(preset.id)}
						>
							<span
								class="h-1 w-full rounded-full bg-gradient-to-r from-slate-500 via-amber-300 to-sky-400"
							></span>
							<span class="max-w-16 truncate text-[10px] font-medium"
								>{editorColorGradePresetLabel(preset.id)}</span
							>
						</button>
					{/each}
					{#each presets as preset (preset.id)}
						<div
							class="group relative min-w-24 rounded-sm border border-[var(--video-editor-border)] bg-[var(--video-editor-control-hover)]"
						>
							<button
								type="button"
								class="flex h-11 w-full flex-col items-start justify-between rounded-sm px-2 py-1 text-left hover:bg-[var(--video-editor-control-hover)] focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)]"
								title={preset.name}
								onclick={() => applyPreset(preset)}
							>
								<span
									class="h-1 w-full rounded-full bg-gradient-to-r from-slate-500 via-amber-300 to-sky-400"
								></span>
								<span class="max-w-20 truncate text-[10px] font-medium">{preset.name}</span>
							</button>
							<button
								type="button"
								class="absolute top-1 right-1 flex size-5 items-center justify-center rounded-sm bg-[var(--video-editor-control)] text-[var(--video-editor-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--video-editor-text)] focus:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)]"
								title={`${m.video_editor_color_delete_preset()}: ${preset.name}`}
								aria-label={`${m.video_editor_color_delete_preset()}: ${preset.name}`}
								onclick={(event) => {
									event.stopPropagation();
									deletePreset(preset);
								}}
							>
								<ThemeIcon role="delete" class="size-3" />
							</button>
						</div>
					{/each}
				</div>
			</div>
			{#if status}
				<p class="mt-0.5 truncate text-[9px] text-[var(--video-editor-muted)]" aria-live="polite">
					{status}
				</p>
			{/if}
		</div>
		<div class="min-h-0 flex-1 overflow-hidden">
			<ColorPrimaryControls
				{itemId}
				{itemIds}
				{onedit}
				onautobalance={() => void autoBalance()}
				onpick={(kind) => void pick(kind)}
				forceAutoKey={autoKey}
			/>
		</div>
	</section>
{/if}

<style>
	.color-tool {
		display: flex;
		height: 1.75rem;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		border-radius: 0.25rem;
		border: 1px solid var(--video-editor-border);
		padding-inline: 0.375rem;
		font-size: 0.625rem;
	}
	.color-tool:hover:not(:disabled),
	.color-icon:hover:not(:disabled) {
		background: var(--video-editor-control-hover);
	}
	.color-tool:focus-visible,
	.color-icon:focus-visible {
		outline: 2px solid var(--video-editor-focus);
		outline-offset: 1px;
	}
	.color-tool:disabled,
	.color-icon:disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}
	.color-icon {
		display: flex;
		height: 1.75rem;
		width: 1.75rem;
		align-items: center;
		justify-content: center;
		border-radius: 0.25rem;
		border: 1px solid var(--video-editor-border);
	}
</style>
