<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import WandSparklesIcon from '@lucide/svelte/icons/wand-sparkles';
	import PipetteIcon from '@lucide/svelte/icons/pipette';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import ClipboardPasteIcon from '@lucide/svelte/icons/clipboard-paste';
	import SaveIcon from '@lucide/svelte/icons/save';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import Columns2Icon from '@lucide/svelte/icons/columns-2';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import CircleOffIcon from '@lucide/svelte/icons/circle-off';
	import AppSelect from '$lib/components/app-select.svelte';
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

	let {
		itemId,
		itemIds = [],
		onedit
	}: { itemId: string | null; itemIds?: string[]; onedit: () => void } = $props();
	let presets = $state<ColorGradePreset[]>([]);
	let selectedPresetId = $state('');
	let presetName = $state('');
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
	const presetOptions = $derived(
		presets.map((preset) => ({ value: preset.id, label: preset.name }))
	);

	onMount(() => {
		presets = loadColorGradePresets();
		selectedPresetId = presets[0]?.id ?? '';
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
		if (grade.length === 0) return;
		colorPreviewStore.copyGrade(grade);
		status = m.video_editor_color_grade_copied({ count: grade.length });
	}

	function applyGrade(effects: readonly GradeEffectSnapshot[], message: string): void {
		if (!itemId || !replaceColorGradeEffects(targetItemIds, effects)) return;
		status = message;
		onedit();
	}

	function pasteGrade(): void {
		const copied = colorPreviewStore.gradeClipboard;
		if (!copied?.length) return;
		applyGrade(copied, m.video_editor_color_grade_pasted({ count: copied.length }));
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
		selectedPresetId = saved?.id ?? selectedPresetId;
		status = m.video_editor_color_preset_saved({ name: saved?.name ?? presetName.trim() });
		presetName = '';
	}

	function applyPreset(): void {
		const preset = presets.find((entry) => entry.id === selectedPresetId);
		if (!preset) return;
		applyGrade(preset.effects, m.video_editor_color_preset_applied({ name: preset.name }));
	}

	function deletePreset(): void {
		const preset = presets.find((entry) => entry.id === selectedPresetId);
		if (!preset) return;
		const next = removeColorGradePreset(presets, preset.id);
		if (!persistColorGradePresets(next)) {
			status = m.video_editor_color_preset_delete_failed();
			return;
		}
		presets = next;
		selectedPresetId = presets[0]?.id ?? '';
		status = m.video_editor_color_preset_deleted({ name: preset.name });
	}
</script>

{#if isVisual}
	<section
		class="mb-2 rounded border border-[oklch(0.3_0.015_55)] bg-[oklch(0.18_0.01_55)] p-2"
		aria-label={m.video_editor_color_workspace()}
	>
		<div class="mb-2 flex items-center justify-between gap-2">
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
			<label class="mb-2 grid grid-cols-[auto_1fr_auto] items-center gap-2 text-[10px]">
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
			class="mb-2 grid grid-cols-4 gap-1"
			role="group"
			aria-label={m.video_editor_color_balance()}
		>
			<button
				type="button"
				class="color-tool"
				title={m.video_editor_color_auto_balance()}
				onclick={() => void autoBalance()}
			>
				<WandSparklesIcon class="size-3.5" />{m.video_editor_color_auto()}
			</button>
			<button
				type="button"
				class="color-tool"
				title={m.video_editor_color_pick_white_balance()}
				onclick={() => void pick('white-balance')}
			>
				<PipetteIcon class="size-3.5" />{m.video_editor_color_white_balance_short()}
			</button>
			<button
				type="button"
				class="color-tool"
				title={m.video_editor_color_pick_black_point()}
				onclick={() => void pick('black-point')}
			>
				<span class="relative"
					><PipetteIcon class="size-3.5" /><span
						class="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full border border-white bg-black"
					></span></span
				>{m.video_editor_color_black_short()}
			</button>
			<button
				type="button"
				class="color-tool"
				title={m.video_editor_color_pick_white_point()}
				onclick={() => void pick('white-point')}
			>
				<span class="relative"
					><PipetteIcon class="size-3.5" /><span
						class="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full border border-black bg-white"
					></span></span
				>{m.video_editor_color_white_short()}
			</button>
		</div>

		<div class="mb-2 grid grid-cols-2 gap-1">
			<button type="button" class="color-tool" disabled={grade.length === 0} onclick={copyGrade}>
				<CopyIcon class="size-3.5" />{m.video_editor_color_copy_grade()}
			</button>
			<button
				type="button"
				class="color-tool"
				disabled={!colorPreviewStore.gradeClipboard?.length}
				onclick={pasteGrade}
			>
				<ClipboardPasteIcon class="size-3.5" />{m.video_editor_color_paste_grade()}
			</button>
		</div>

		<div class="grid grid-cols-[1fr_auto_auto] gap-1">
			<Input
				class="h-7 min-w-0 rounded border border-[oklch(0.32_0.015_55)] bg-[oklch(0.14_0.008_55)] px-2 text-xs"
				bind:value={presetName}
				placeholder={m.video_editor_color_preset_name()}
				aria-label={m.video_editor_color_preset_name()}
				onkeydown={(event) => {
					if (event.key === 'Enter') savePreset();
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
			<span class="w-7"></span>
		</div>
		{#if presets.length > 0}
			<div class="mt-1 grid grid-cols-[1fr_auto_auto] gap-1">
				<AppSelect
					class="h-7 min-w-0 text-xs"
					bind:value={selectedPresetId}
					ariaLabel={m.video_editor_color_presets()}
					options={presetOptions}
				/>
				<button
					type="button"
					class="color-tool px-2"
					disabled={!selectedPresetId}
					onclick={applyPreset}
				>
					{m.video_editor_color_apply_preset()}
				</button>
				<button
					type="button"
					class="color-icon"
					disabled={!selectedPresetId}
					title={m.video_editor_color_delete_preset()}
					aria-label={m.video_editor_color_delete_preset()}
					onclick={deletePreset}
				>
					<Trash2Icon class="size-3.5" />
				</button>
			</div>
		{/if}
		<p class="mt-1 min-h-4 text-[10px] text-[oklch(0.68_0.02_55)]" aria-live="polite">{status}</p>
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
