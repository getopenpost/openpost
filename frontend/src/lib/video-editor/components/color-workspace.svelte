<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import ClipboardPasteIcon from '@lucide/svelte/icons/clipboard-paste';
	import SaveIcon from '@lucide/svelte/icons/save';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import Columns2Icon from '@lucide/svelte/icons/columns-2';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import CircleOffIcon from '@lucide/svelte/icons/circle-off';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import { Input } from '$lib/components/ui/input';
	import { Slider } from '$lib/components/ui/slider';
	import { m } from '$lib/paraglide/messages';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import {
		autoBalanceFromFrame,
		blackPointFromPick,
		hasColorGrade,
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
	import {
		replaceColorGradeEffects,
		upsertGpuEffectParamsOnItems
	} from '$lib/video-editor/timeline/actions/effects';
	import { getGpuEffectDefaultParams } from '$lib/video-editor/effects/gpu/registry';
	import {
		copyColorGradeFromItem,
		pasteColorGradeToItems
	} from '$lib/video-editor/effects/color-grade-clipboard';
	import ColorPrimaryControls from './color-primary-controls.svelte';

	let {
		itemId,
		itemIds = [],
		onedit,
		oncreateadjustment
	}: {
		itemId: string | null;
		itemIds?: string[];
		onedit: () => void;
		oncreateadjustment?: () => void;
	} = $props();
	let presets = $state<ColorGradePreset[]>([]);
	let presetName = $state('');
	let showPresetSave = $state(false);
	let status = $state('');

	const item = $derived(itemId ? timelineStore.itemById.get(itemId) : undefined);
	const grade = $derived(snapshotColorGrade(item?.effects));
	const hasGrade = $derived(hasColorGrade(item?.effects));
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
		const effect = item?.effects?.find(
			(entry) => entry.type === 'gpu' && entry.effectId === 'gpu-color-wheels'
		);
		if (!effect || effect.type !== 'gpu') return Number(defaults[name] ?? 0);
		return Number(effect.params[name] ?? defaults[name] ?? 0);
	}

	function applyWheelParams(updates: Record<string, number>, message: string): void {
		if (!itemId) return;
		status = message;
		if (upsertGpuEffectParamsOnItems(targetItemIds, 'gpu-color-wheels', updates)) onedit();
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
		colorPreviewStore.setComparisonMode(mode);
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
		class="flex h-full min-h-0 flex-col overflow-hidden bg-[oklch(0.16_0.009_55)]"
		aria-label={m.video_editor_color_workspace()}
	>
		<div class="shrink-0 border-b border-white/10 px-2 py-1.5">
			<div class="flex items-center justify-between gap-2">
				<h3 class="text-xs font-semibold tracking-wide text-[oklch(0.78_0.03_55)] uppercase">
					{m.video_editor_color_workspace()}
				</h3>
				<div
					class="grid grid-cols-3 overflow-hidden rounded border border-[oklch(0.32_0.015_55)]"
					role="group"
					aria-label={m.video_editor_color_compare_mode()}
				>
					<button
						type="button"
						class="flex h-7 items-center gap-1 px-2 text-[10px] {colorPreviewStore.comparisonMode ===
						'after'
							? 'bg-[oklch(0.62_0.13_45)] text-black'
							: 'hover:bg-[oklch(0.25_0.015_55)]'}"
						aria-pressed={colorPreviewStore.comparisonMode === 'after'}
						onclick={() => setComparison('after')}
					>
						<EyeIcon class="size-3" />{m.video_editor_color_after()}
					</button>
					<button
						type="button"
						class="flex h-7 items-center gap-1 border-l border-[oklch(0.32_0.015_55)] px-2 text-[10px] {colorPreviewStore.comparisonMode ===
						'before'
							? 'bg-[oklch(0.62_0.13_45)] text-black'
							: 'hover:bg-[oklch(0.25_0.015_55)]'}"
						disabled={!hasGrade}
						aria-pressed={colorPreviewStore.comparisonMode === 'before'}
						onclick={() => setComparison('before')}
					>
						<CircleOffIcon class="size-3" />{m.video_editor_color_before()}
					</button>
					<button
						type="button"
						class="flex h-7 items-center gap-1 border-l border-[oklch(0.32_0.015_55)] px-2 text-[10px] {colorPreviewStore.comparisonMode ===
						'split'
							? 'bg-[oklch(0.62_0.13_45)] text-black'
							: 'hover:bg-[oklch(0.25_0.015_55)]'}"
						disabled={!hasGrade}
						aria-pressed={colorPreviewStore.comparisonMode === 'split'}
						onclick={() => setComparison('split')}
					>
						<Columns2Icon class="size-3" />{m.video_editor_color_split()}
					</button>
				</div>
			</div>

			{#if colorPreviewStore.comparisonMode === 'split'}
				<label class="mt-1 grid grid-cols-[auto_1fr_auto] items-center gap-2 text-[10px]">
					<span>{m.video_editor_color_before()}</span>
					<Slider
						min={0.05}
						max={0.95}
						step={0.01}
						value={colorPreviewStore.splitPosition}
						ariaLabel={m.video_editor_color_split_position()}
						onValueChange={(value) => colorPreviewStore.setSplitPosition(value)}
						onValueCommit={(value) => colorPreviewStore.setSplitPosition(value)}
					/>
					<span>{m.video_editor_color_after()}</span>
				</label>
			{/if}

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
					<CopyIcon class="size-3.5" />{m.video_editor_color_copy_grade()}
				</button>
				<button
					type="button"
					class="color-tool min-w-24 flex-1"
					disabled={!colorPreviewStore.gradeClipboard?.length}
					onclick={pasteGrade}
				>
					<ClipboardPasteIcon class="size-3.5" />{m.video_editor_color_paste_grade()}
				</button>
				{#if oncreateadjustment}
					<button
						type="button"
						class="color-tool min-w-28 flex-1"
						title={m.video_editor_adjustment_layer_hint()}
						onclick={oncreateadjustment}
					>
						<LayersIcon class="size-3.5" />{m.video_editor_adjustment_layer()}
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
					<SaveIcon class="size-3.5" />
				</button>
			</div>
			{#if showPresetSave}
				<div class="mt-1 grid grid-cols-[1fr_auto] gap-1">
					<Input
						class="h-7 min-w-0 rounded border border-[oklch(0.32_0.015_55)] bg-[oklch(0.12_0.006_55)] px-2 text-xs"
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
						<SaveIcon class="size-3.5" />
					</button>
				</div>
			{/if}
			{#if presets.length > 0}
				<div class="mt-1" aria-label={m.video_editor_color_presets()}>
					<div class="mb-1 text-[9px] tracking-wide text-white/40 uppercase">
						{m.video_editor_color_presets()}
					</div>
					<div class="flex gap-1 overflow-x-auto pb-1">
						{#each presets as preset (preset.id)}
							<div
								class="group relative min-w-24 rounded-sm border border-white/10 bg-white/[0.025]"
							>
								<button
									type="button"
									class="flex h-11 w-full flex-col items-start justify-between rounded-sm px-2 py-1 text-left hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-orange-400"
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
									class="absolute top-1 right-1 flex size-5 items-center justify-center rounded-sm bg-black/60 text-white/60 opacity-0 group-hover:opacity-100 hover:text-white focus:opacity-100 focus-visible:outline-2 focus-visible:outline-orange-400"
									title={`${m.video_editor_color_delete_preset()}: ${preset.name}`}
									aria-label={`${m.video_editor_color_delete_preset()}: ${preset.name}`}
									onclick={(event) => {
										event.stopPropagation();
										deletePreset(preset);
									}}
								>
									<Trash2Icon class="size-3" />
								</button>
							</div>
						{/each}
					</div>
				</div>
			{/if}
			{#if status}
				<p class="mt-0.5 truncate text-[9px] text-[oklch(0.68_0.02_55)]" aria-live="polite">
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
		border: 1px solid oklch(0.32 0.015 55);
		padding-inline: 0.375rem;
		font-size: 0.625rem;
	}
	.color-tool:hover:not(:disabled),
	.color-icon:hover:not(:disabled) {
		background: oklch(0.27 0.015 55);
	}
	.color-tool:focus-visible,
	.color-icon:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
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
		border: 1px solid oklch(0.32 0.015 55);
	}
</style>
