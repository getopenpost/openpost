<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import EditorColorSlider from '$lib/components/editor-color-slider.svelte';
	import EditorColorComparison from '$lib/components/editor-color-comparison.svelte';
	import {
		EDITOR_COLOR_GRADE_PRESETS,
		editorColorGradePresetLabel
	} from '$lib/editor-color-grade/presets';
	import { m } from '$lib/paraglide/messages';
	import {
		IMAGE_COLOR_GRADE_VERSION,
		defaultEditorColorGradeAdjustments
	} from '$lib/editor-color-grade/model';
	import { defaultImageAdjustments } from '../document';
	import { imageEditorMixedValue, useImageEditor } from '../editor.svelte';
	import type { ImageEditorImageAdjustments, ImageEditorLayer } from '../types';
	import {
		EDITOR_COLOR_ADJUSTMENT_GROUPS,
		EDITOR_COLOR_ADJUSTMENT_KEYS,
		EDITOR_COLOR_ADJUSTMENT_RANGES,
		type EditorColorComparisonMode
	} from '$lib/editor-color-grade/controls';

	type ColorScope = 'layer' | 'page';
	type AdjustmentControl = readonly [string, keyof ImageEditorImageAdjustments, number, number];

	const editor = useImageEditor();
	let scope = $state<ColorScope>('page');
	const imageAdjustmentKeys = [...EDITOR_COLOR_ADJUSTMENT_KEYS, 'blur'] satisfies Array<
		keyof ImageEditorImageAdjustments
	>;
	function adjustmentLabel(key: keyof ImageEditorImageAdjustments): string {
		if (key === 'brightness') return m.image_editor_brightness();
		if (key === 'exposure') return m.image_editor_exposure();
		if (key === 'contrast') return m.image_editor_contrast();
		if (key === 'highlights') return m.image_editor_highlights();
		if (key === 'shadows') return m.image_editor_shadows();
		if (key === 'temperature') return m.image_editor_temperature();
		if (key === 'tint') return m.image_editor_tint();
		if (key === 'vibrance') return m.image_editor_vibrance();
		if (key === 'saturation') return m.image_editor_saturation();
		if (key === 'hue') return m.image_editor_hue();
		return m.image_editor_blur();
	}
	const adjustmentGroups: Array<{
		label: string;
		controls: AdjustmentControl[];
		pageSupported: boolean;
	}> = [
		...EDITOR_COLOR_ADJUSTMENT_GROUPS.map((group) => ({
			label: group.id === 'tone' ? m.image_editor_tone() : m.image_editor_color(),
			pageSupported: true,
			controls: group.keys.map(
				(key): AdjustmentControl => [
					adjustmentLabel(key),
					key,
					EDITOR_COLOR_ADJUSTMENT_RANGES[key].min,
					EDITOR_COLOR_ADJUSTMENT_RANGES[key].max
				]
			)
		})),
		{
			label: m.image_editor_detail(),
			pageSupported: false,
			controls: [[m.image_editor_blur(), 'blur', 0, 1]]
		}
	];

	const selectedImageLayers = $derived(
		editor.selectedLayers.filter((layer) => layer.type === 'image' && layer.image && !layer.locked)
	);
	const pageImageLayers = $derived(
		(editor.activePage?.layers ?? []).filter(
			(layer) => layer.type === 'image' && layer.image && !layer.locked
		)
	);
	const targetLayers = $derived(scope === 'page' ? pageImageLayers : selectedImageLayers);
	const targetLayerIDs = $derived(targetLayers.map((layer) => layer.id));
	const activePage = $derived(editor.activePage);
	const targetCount = $derived(scope === 'page' ? (activePage ? 1 : 0) : targetLayers.length);
	const hasGrade = $derived(
		scope === 'page'
			? Object.values(activePage?.color_grade ?? {}).some((value) => Math.abs(value) > 0.0001)
			: targetLayers.some((layer) =>
					imageAdjustmentKeys.some((key) => Math.abs(layer.image?.adjustments[key] ?? 0) > 0.0001)
				)
	);

	$effect(() => {
		if (!editor.colorComparisonBefore) return;
		if (!hasGrade) {
			setComparison('after');
			return;
		}
		editor.colorComparisonPage = scope === 'page';
		editor.colorComparisonLayerIDs = scope === 'layer' ? [...targetLayerIDs] : [];
	});

	onDestroy(() => {
		editor.cancelImageAdjustmentGesture();
		editor.cancelPageColorGradeGesture();
		setComparison('after');
	});

	function adjustmentValue(key: keyof ImageEditorImageAdjustments): number | null {
		if (scope === 'page') {
			if (key === 'blur') return 0;
			return activePage?.color_grade?.[key] ?? 0;
		}
		const mixed = imageEditorMixedValue(
			targetLayers.map((layer) => layer.image?.adjustments[key] ?? 0)
		);
		return mixed.mixed ? null : (mixed.value ?? 0);
	}

	function previewAdjustment(key: keyof ImageEditorImageAdjustments, value: number): void {
		if (scope === 'page') {
			if (key !== 'blur' && activePage) editor.previewPageColorGrade(activePage.id, key, value);
			return;
		}
		editor.previewImageAdjustment(targetLayerIDs, key, value);
	}

	function commitAdjustment(key: keyof ImageEditorImageAdjustments, value: number): void {
		previewAdjustment(key, value);
		if (scope === 'page') editor.commitPageColorGradeGesture();
		else editor.commitImageAdjustmentGesture();
	}

	function applyPreset(adjustments: Partial<ImageEditorImageAdjustments>): void {
		if (scope === 'page') {
			if (!activePage) return;
			editor.mutate(m.image_editor_adjustments(), (document) => {
				const page = document.pages.find((candidate) => candidate.id === activePage.id);
				if (!page) return;
				page.color_grade_version = IMAGE_COLOR_GRADE_VERSION;
				page.color_grade = { ...defaultEditorColorGradeAdjustments(), ...adjustments };
			});
			return;
		}
		const ids = new Set(targetLayerIDs);
		if (ids.size === 0) return;
		editor.mutate(m.image_editor_adjustments(), (document) => {
			for (const page of document.pages) {
				for (const layer of page.layers) {
					if (!ids.has(layer.id) || layer.locked || !layer.image) continue;
					layer.image.color_grade_version = IMAGE_COLOR_GRADE_VERSION;
					layer.image.adjustments = { ...defaultImageAdjustments(), ...adjustments };
				}
			}
		});
	}

	function presetIsActive(adjustments: Partial<ImageEditorImageAdjustments>): boolean {
		const target = {
			...(scope === 'page' ? defaultEditorColorGradeAdjustments() : defaultImageAdjustments()),
			...adjustments
		};
		if (scope === 'page') {
			if (!activePage) return false;
			return imageAdjustmentKeys
				.filter((key) => key !== 'blur')
				.every((key) => Math.abs((activePage.color_grade?.[key] ?? 0) - target[key]) < 0.001);
		}
		if (targetLayers.length === 0) return false;
		return targetLayers.every((layer) =>
			imageAdjustmentKeys.every(
				(key) => Math.abs((layer.image?.adjustments[key] ?? 0) - target[key]) < 0.001
			)
		);
	}

	function setScope(next: ColorScope): void {
		editor.commitImageAdjustmentGesture();
		editor.commitPageColorGradeGesture();
		setComparison('after');
		scope = next;
	}

	function setComparison(mode: EditorColorComparisonMode): void {
		const comparingBefore = mode === 'before';
		editor.colorComparisonBefore = comparingBefore;
		editor.colorComparisonPage = comparingBefore && scope === 'page';
		editor.colorComparisonLayerIDs =
			comparingBefore && scope === 'layer' ? [...targetLayerIDs] : [];
	}
</script>

<div class="space-y-5" data-image-color-workspace>
	<div class="space-y-2">
		<div
			class="grid grid-cols-2 overflow-hidden rounded-md border"
			role="group"
			aria-label={`${m.image_editor_color()} ${m.image_editor_layers()}`}
		>
			<Button
				type="button"
				variant={scope === 'layer' ? 'secondary' : 'ghost'}
				class="rounded-none"
				aria-pressed={scope === 'layer'}
				onclick={() => setScope('layer')}
			>
				{m.image_editor_layer()}
			</Button>
			<Button
				type="button"
				variant={scope === 'page' ? 'secondary' : 'ghost'}
				class="rounded-none border-l"
				aria-pressed={scope === 'page'}
				onclick={() => setScope('page')}
			>
				{m.image_editor_pages()}
			</Button>
		</div>
		<p class="text-xs text-muted-foreground" aria-live="polite">
			{m.image_editor_selected_count({ count: targetCount })}
		</p>
	</div>

	<EditorColorComparison
		mode={editor.colorComparisonBefore ? 'before' : 'after'}
		disabled={!hasGrade}
		ariaLabel={m.video_editor_color_compare_mode()}
		afterLabel={m.video_editor_color_after()}
		beforeLabel={m.video_editor_color_before()}
		onmodechange={setComparison}
	/>

	{#if targetCount === 0}
		<p class="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
			{m.image_editor_command_requires_selection()}
		</p>
	{:else}
		<section class="space-y-2">
			<h3 class="text-xs font-medium">{m.image_editor_quick_looks()}</h3>
			<div class="grid grid-cols-3 gap-1">
				{#each EDITOR_COLOR_GRADE_PRESETS as preset (preset.id)}
					<Button
						type="button"
						variant={presetIsActive(preset.adjustments) ? 'secondary' : 'outline'}
						size="xs"
						disabled={!editor.canEdit}
						aria-pressed={presetIsActive(preset.adjustments)}
						onclick={() => applyPreset(preset.adjustments)}
					>
						{editorColorGradePresetLabel(preset.id)}
					</Button>
				{/each}
			</div>
		</section>

		{#each adjustmentGroups.filter((group) => scope === 'layer' || group.pageSupported) as group (group.label)}
			<section class="space-y-3 border-t pt-4">
				<h3 class="text-xs font-medium">{group.label}</h3>
				{#each group.controls as [label, key, min, max] (key)}
					<EditorColorSlider
						{label}
						value={adjustmentValue(key)}
						{min}
						{max}
						step={0.01}
						displayScale={100}
						decimals={0}
						mixedLabel={m.image_editor_mixed_value()}
						resetLabel={m.image_editor_reset()}
						disabled={!editor.canEdit}
						onbegin={() => {
							if (scope === 'page') {
								if (key !== 'blur' && activePage)
									editor.beginPageColorGradeGesture(activePage.id, key);
							} else editor.beginImageAdjustmentGesture(targetLayerIDs, key);
						}}
						onpreview={(value) => previewAdjustment(key, value)}
						oncommit={(value) => commitAdjustment(key, value)}
						oncancel={() => {
							if (scope === 'page') editor.cancelPageColorGradeGesture();
							else editor.cancelImageAdjustmentGesture();
						}}
					/>
				{/each}
			</section>
		{/each}
	{/if}
</div>
