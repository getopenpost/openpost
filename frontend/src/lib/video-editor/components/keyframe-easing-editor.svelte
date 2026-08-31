<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Slider } from '$lib/components/ui/slider';
	import { m } from '$lib/paraglide/messages';
	import type {
		BezierControlPoints,
		EasingConfig,
		EasingType,
		KeyframeProperty,
		SpringParameters
	} from '$lib/video-editor/project/types';
	import { DEFAULT_BEZIER_POINTS, DEFAULT_SPRING_PARAMS } from '$lib/video-editor/project/types';
	import {
		loadCustomEasingPresets,
		presetFromEasing,
		saveCustomEasingPresets,
		suggestedCustomPresetName,
		upsertCustomEasingPreset,
		type CustomEasingPreset
	} from '$lib/video-editor/timeline/custom-easing-presets';
	import {
		clampBezierValue,
		clampSpringValue,
		buildEasingConfig
	} from '$lib/video-editor/timeline/easing-presets';
	import {
		EASING_PRESETS,
		SPRING_PRESETS,
		presetDirection,
		type EasingPreset
	} from '$lib/video-editor/timeline/easings-dev-presets';
	import type { EditorKeyframe } from '$lib/video-editor/timeline/keyframe-editor';

	export interface SegmentEasingUpdate {
		property: KeyframeProperty;
		frame: number;
		easing: EasingType;
		easingConfig?: EasingConfig;
	}

	let {
		keyframe,
		endFrame,
		property,
		selectedFrames,
		onchange,
		onpreview,
		onclose
	}: {
		keyframe: EditorKeyframe;
		endFrame: number;
		property: KeyframeProperty;
		selectedFrames: number[];
		onchange: (updates: SegmentEasingUpdate[]) => void;
		onpreview: (config: EasingConfig | null) => void;
		onclose: () => void;
	} = $props();

	type SpringGesture = { original: SpringParameters; draft: SpringParameters };
	type BezierGesture = { original: BezierControlPoints; draft: BezierControlPoints };

	let activeEasing = $state<EasingType>('linear');
	let springGesture = $state<SpringGesture | null>(null);
	let bezierGesture = $state<BezierGesture | null>(null);
	let direction = $state<'all' | 'in' | 'out' | 'inout'>('all');
	let showAllEasing = $state(false);
	let customPresets = $state<CustomEasingPreset[]>([]);
	let customPresetName = $state('');
	let presetSaveError = $state<string | null>(null);
	let hydrated = false;
	let resetKey = '';

	const filteredEasingPresets = $derived.by(() => {
		if (direction === 'all') return EASING_PRESETS;
		return EASING_PRESETS.filter((preset) => presetDirection(preset.name) === direction);
	});
	const visibleEasingPresets = $derived(
		showAllEasing ? filteredEasingPresets : filteredEasingPresets.slice(0, 8)
	);
	const targetFrames = $derived(
		selectedFrames.length > 1 ? [...new Set(selectedFrames)] : [keyframe.frame]
	);
	const currentConfig = $derived.by((): EasingConfig | undefined => {
		if (activeEasing === 'cubic-bezier') {
			return {
				type: 'cubic-bezier',
				bezier: {
					...(bezierGesture?.draft ?? keyframe.easingConfig?.bezier ?? DEFAULT_BEZIER_POINTS)
				}
			};
		}
		if (activeEasing === 'spring') {
			return {
				type: 'spring',
				spring: {
					...(springGesture?.draft ?? keyframe.easingConfig?.spring ?? DEFAULT_SPRING_PARAMS)
				}
			};
		}
		return undefined;
	});

	$effect(() => {
		if (typeof window === 'undefined' || hydrated) return;
		hydrated = true;
		customPresets = loadCustomEasingPresets();
	});

	$effect(() => {
		const nextKey = `${keyframe.frame}:${keyframe.easing}`;
		if (resetKey === nextKey) return;
		resetKey = nextKey;
		activeEasing = keyframe.easing;
		direction = 'all';
		showAllEasing = false;
		customPresetName = '';
		presetSaveError = null;
		bezierGesture = null;
		const spring = keyframe.easingConfig?.spring ?? DEFAULT_SPRING_PARAMS;
		springGesture =
			keyframe.easing === 'spring' ? { original: { ...spring }, draft: { ...spring } } : null;
	});

	function applyUpdates(easing: EasingType, easingConfig?: EasingConfig): void {
		onchange(targetFrames.map((frame) => ({ property, frame, easing, easingConfig })));
	}

	function selectEasing(easing: EasingType): void {
		activeEasing = easing;
		const config = buildEasingConfig(easing, keyframe.easingConfig);
		if (easing === 'spring') {
			const spring = config?.spring ?? DEFAULT_SPRING_PARAMS;
			springGesture = { original: { ...spring }, draft: { ...spring } };
		} else springGesture = null;
		bezierGesture = null;
		onpreview(null);
		applyUpdates(easing, config);
	}

	function beginBezierGesture(): BezierGesture {
		if (bezierGesture) return bezierGesture;
		const current = keyframe.easingConfig?.bezier ?? DEFAULT_BEZIER_POINTS;
		bezierGesture = { original: { ...current }, draft: { ...current } };
		return bezierGesture;
	}

	function previewBezier(field: keyof BezierControlPoints, value: number): void {
		const gesture = beginBezierGesture();
		const draft = { ...gesture.draft, [field]: clampBezierValue(field, value) };
		bezierGesture = { ...gesture, draft };
		onpreview({ type: 'cubic-bezier', bezier: draft });
	}

	function commitBezier(): void {
		if (!bezierGesture) return;
		const { draft, original } = bezierGesture;
		bezierGesture = null;
		onpreview(null);
		if (sameBezier(draft, keyframe.easingConfig?.bezier ?? original)) return;
		applyUpdates('cubic-bezier', { type: 'cubic-bezier', bezier: { ...draft } });
	}

	function cancelBezier(): void {
		bezierGesture = null;
		onpreview(null);
	}

	function beginSpringGesture(): SpringGesture {
		if (springGesture) return springGesture;
		const current = keyframe.easingConfig?.spring ?? DEFAULT_SPRING_PARAMS;
		springGesture = { original: { ...current }, draft: { ...current } };
		return springGesture;
	}

	function previewSpring(field: keyof SpringParameters, value: number): void {
		const gesture = beginSpringGesture();
		const draft = { ...gesture.draft, [field]: clampSpringValue(field, value) };
		springGesture = { ...gesture, draft };
		onpreview({ type: 'spring', spring: draft });
	}

	function commitSpring(): void {
		if (!springGesture) return;
		const { draft, original } = springGesture;
		springGesture = null;
		onpreview(null);
		if (sameSpring(draft, keyframe.easingConfig?.spring ?? original)) return;
		applyUpdates('spring', { type: 'spring', spring: { ...draft } });
	}

	function cancelSpring(): void {
		springGesture = null;
		onpreview(null);
	}

	function applyPreset(preset: EasingPreset | CustomEasingPreset): void {
		activeEasing = preset.type === 'Spring' ? 'spring' : 'cubic-bezier';
		const config: EasingConfig =
			preset.type === 'Spring'
				? { type: 'spring', spring: { ...preset.spring } }
				: { type: 'cubic-bezier', bezier: { ...preset.bezier } };
		springGesture =
			config.type === 'spring' && config.spring
				? { original: { ...config.spring }, draft: { ...config.spring } }
				: null;
		bezierGesture = null;
		onpreview(null);
		applyUpdates(activeEasing, config);
	}

	function savePreset(): void {
		const name = customPresetName.trim() || suggestedCustomPresetName(customPresets);
		const preset = presetFromEasing(name, currentConfig);
		if (!preset) return;
		const next = upsertCustomEasingPreset(customPresets, preset);
		if (!saveCustomEasingPresets(next)) {
			presetSaveError = m.video_editor_effects_preset_save_failed();
			return;
		}
		customPresets = next;
		customPresetName = preset.name;
		presetSaveError = null;
	}

	function deletePreset(name: string): void {
		const next = customPresets.filter((preset) => preset.name !== name);
		if (!saveCustomEasingPresets(next)) {
			presetSaveError = m.video_editor_effects_preset_save_failed();
			return;
		}
		customPresets = next;
		if (customPresetName === name) customPresetName = '';
		presetSaveError = null;
	}

	function close(): void {
		onpreview(null);
		onclose();
	}

	function sameBezier(a: BezierControlPoints, b: BezierControlPoints): boolean {
		return a.x1 === b.x1 && a.y1 === b.y1 && a.x2 === b.x2 && a.y2 === b.y2;
	}

	function sameSpring(a: SpringParameters, b: SpringParameters): boolean {
		return a.tension === b.tension && a.friction === b.friction && a.mass === b.mass;
	}
</script>

<div
	class="mx-2 mb-2 rounded-md border border-[oklch(0.28_0.015_55)] bg-[oklch(0.18_0.01_50)] p-2 shadow-lg"
	data-segment-menu
>
	<div class="mb-2 flex flex-wrap items-center gap-1">
		<span class="mr-auto text-[10px] font-medium text-[oklch(0.72_0.02_55)]">
			{m.video_editor_keyframe_graph_segment()} · {keyframe.frame} → {endFrame}
		</span>
		<Button variant="ghost" size="sm" class="h-6 min-h-6 px-2 text-[10px]" onclick={close}
			>{m.video_editor_keyframe_graph_close()}</Button
		>
	</div>
	<div class="flex flex-wrap gap-1">
		{#each [{ value: 'linear' as const, label: m.video_editor_keyframe_easing_linear() }, { value: 'ease-in' as const, label: m.video_editor_keyframe_easing_in() }, { value: 'ease-out' as const, label: m.video_editor_keyframe_easing_out() }, { value: 'ease-in-out' as const, label: m.video_editor_keyframe_easing_in_out() }, { value: 'hold' as const, label: m.video_editor_keyframe_easing_hold() }, { value: 'cubic-bezier' as const, label: m.video_editor_keyframe_easing_bezier() }, { value: 'spring' as const, label: m.video_editor_keyframe_easing_spring() }] as option}
			<button
				class="rounded px-2 py-1 text-[10px] font-medium focus-visible:ring-2 focus-visible:ring-[oklch(0.85_0.15_45/0.5)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.85_0.15_45)] {activeEasing ===
				option.value
					? 'bg-[oklch(0.66_0.14_45)] text-white'
					: 'bg-[oklch(0.25_0.01_50)] text-[oklch(0.88_0.02_55)] hover:bg-[oklch(0.32_0.02_55)] hover:text-white'}"
				aria-pressed={activeEasing === option.value}
				onclick={() => selectEasing(option.value)}>{option.label}</button
			>
		{/each}
	</div>

	{#if activeEasing === 'cubic-bezier'}
		<div class="mt-2 flex flex-wrap gap-1">
			{#each [{ value: 'all' as const, label: m.video_editor_keyframe_sheet_filter_all() }, { value: 'in' as const, label: m.video_editor_keyframe_easing_in() }, { value: 'out' as const, label: m.video_editor_keyframe_easing_out() }, { value: 'inout' as const, label: m.video_editor_keyframe_easing_in_out() }] as filter}
				<button
					class="rounded px-1.5 py-1 text-[9px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[oklch(0.85_0.15_45)] {direction ===
					filter.value
						? 'bg-[oklch(0.45_0.02_55)] text-white'
						: 'bg-[oklch(0.22_0.01_50)] text-[oklch(0.78_0.02_55)] hover:bg-[oklch(0.32_0.02_55)]'}"
					onclick={() => (direction = filter.value)}>{filter.label}</button
				>
			{/each}
			<button
				class="ml-auto rounded px-1.5 py-1 text-[9px] focus-visible:outline-2 focus-visible:outline-[oklch(0.85_0.15_45)] {showAllEasing
					? 'bg-[oklch(0.45_0.02_55)] text-white'
					: 'bg-[oklch(0.22_0.01_50)] text-[oklch(0.78_0.02_55)]'}"
				onclick={() => (showAllEasing = !showAllEasing)}
				>{showAllEasing ? m.video_editor_keyframe_graph_close() : m.media_show_all()}</button
			>
		</div>
		<div class="mt-2 flex flex-wrap gap-1">
			{#each visibleEasingPresets as preset}
				<button
					class="rounded border border-[oklch(0.28_0.015_55)] bg-[oklch(0.22_0.01_50)] px-1.5 py-1 text-[9px] text-[oklch(0.88_0.02_55)] hover:bg-[oklch(0.32_0.02_55)] focus-visible:ring-2 focus-visible:ring-[oklch(0.85_0.15_45/0.5)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.85_0.15_45)]"
					title={preset.name}
					onclick={() => applyPreset(preset)}>{preset.name}</button
				>
			{/each}
		</div>
		{@const draft = bezierGesture?.draft ?? keyframe.easingConfig?.bezier ?? DEFAULT_BEZIER_POINTS}
		<div class="mt-2 grid grid-cols-2 gap-2" data-bezier-gesture>
			{#each [{ key: 'x1' as const, min: 0, max: 1 }, { key: 'y1' as const, min: -2, max: 3 }, { key: 'x2' as const, min: 0, max: 1 }, { key: 'y2' as const, min: -2, max: 3 }] as field}
				<label class="flex flex-col gap-1 text-[10px] text-[oklch(0.78_0.02_55)]">
					<span>{field.key}</span>
					<Input
						type="number"
						min={field.min}
						max={field.max}
						step={0.01}
						value={draft[field.key]}
						class="w-full rounded border border-[oklch(0.28_0.015_55)] bg-[oklch(0.22_0.01_50)] px-1 py-1 text-[10px] text-white"
						oninput={(event) => previewBezier(field.key, Number(event.currentTarget.value))}
						onchange={commitBezier}
						onpointercancel={cancelBezier}
						onlostpointercapture={cancelBezier}
						onkeydown={(event) => {
							if (event.key === 'Escape') {
								event.preventDefault();
								cancelBezier();
							}
							if (event.key === 'Enter') commitBezier();
						}}
					/>
				</label>
			{/each}
		</div>
	{/if}

	{#if activeEasing === 'spring'}
		<div class="mt-2 flex flex-wrap gap-1">
			{#each SPRING_PRESETS as preset}
				<button
					class="rounded border border-[oklch(0.28_0.015_55)] bg-[oklch(0.22_0.01_50)] px-1.5 py-1 text-[9px] text-[oklch(0.88_0.02_55)] hover:bg-[oklch(0.32_0.02_55)] focus-visible:ring-2 focus-visible:ring-[oklch(0.85_0.15_45/0.5)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.85_0.15_45)]"
					title={preset.name}
					onclick={() => applyPreset(preset)}>{preset.name}</button
				>
			{/each}
		</div>
		{@const draft = springGesture?.draft ?? keyframe.easingConfig?.spring ?? DEFAULT_SPRING_PARAMS}
		<div class="mt-2 grid grid-cols-3 gap-2" data-spring-gesture>
			{#each [{ key: 'tension' as const, label: m.video_editor_keyframe_graph_tension(), min: 1, max: 1000, step: 1 }, { key: 'friction' as const, label: m.video_editor_keyframe_graph_friction(), min: 1, max: 100, step: 1 }, { key: 'mass' as const, label: m.video_editor_keyframe_graph_mass(), min: 0.1, max: 10, step: 0.1 }] as field}
				<label class="flex flex-col gap-1 text-[10px] text-[oklch(0.78_0.02_55)]">
					{field.label}
					<Slider
						min={field.min}
						max={field.max}
						step={field.step}
						value={draft[field.key]}
						ariaLabel={field.label}
						onValueChange={(value) => previewSpring(field.key, value)}
						onValueCommit={(value) => {
							previewSpring(field.key, value);
							commitSpring();
						}}
						onValueCancel={cancelSpring}
					/>
					<span class="font-mono text-[9px]">{draft[field.key]}</span>
				</label>
			{/each}
		</div>
	{/if}

	{#if customPresets.length > 0}
		<div class="mt-3 border-t border-[oklch(0.28_0.015_55)] pt-2">
			<span class="mb-1 block text-[10px] font-medium text-[oklch(0.88_0.02_55)]"
				>{m.video_editor_keyframe_custom_presets()}</span
			>
			<div class="flex flex-wrap gap-1">
				{#each customPresets as preset (preset.name)}
					<div
						class="flex items-center gap-1 rounded border border-[oklch(0.28_0.015_55)] bg-[oklch(0.22_0.01_50)] px-1.5 py-1"
					>
						<button
							class="text-[9px] text-[oklch(0.88_0.02_55)] hover:text-white focus-visible:ring-1 focus-visible:ring-[oklch(0.85_0.15_45)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[oklch(0.85_0.15_45)]"
							onclick={() => applyPreset(preset)}>{preset.name}</button
						>
						<button
							class="rounded bg-[oklch(0.32_0.02_55)] px-1 py-0.5 text-[8px] font-medium text-[oklch(0.95_0.02_55)] hover:bg-[oklch(0.85_0.15_45)] hover:text-white focus-visible:ring-1 focus-visible:ring-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[oklch(0.85_0.15_45)]"
							aria-label={`${m.video_editor_keyframe_preset_delete()} ${preset.name}`}
							onclick={() => deletePreset(preset.name)}
							>{m.video_editor_keyframe_preset_delete()}</button
						>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	{#if currentConfig}
		<div class="mt-2 flex flex-wrap items-end gap-2">
			<label class="min-w-32 flex-1 text-[10px] text-[oklch(0.78_0.02_55)]">
				<span class="mb-1 block">{m.video_editor_keyframe_preset_name()}</span>
				<Input
					data-testid="segment-preset-name"
					bind:value={customPresetName}
					placeholder={suggestedCustomPresetName(customPresets)}
					class="h-7 w-full rounded border border-[oklch(0.28_0.015_55)] bg-[oklch(0.22_0.01_50)] px-2 text-[10px] text-white placeholder:text-[oklch(0.58_0.014_55)]"
					onkeydown={(event) => {
						if (event.key === 'Enter') savePreset();
					}}
				/>
			</label>
			<button
				data-testid="segment-preset-save"
				class="h-7 rounded bg-[oklch(0.66_0.14_45)] px-2 text-[10px] font-medium text-white hover:bg-[oklch(0.72_0.16_45)] focus-visible:ring-2 focus-visible:ring-[oklch(0.85_0.15_45/0.5)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.85_0.15_45)]"
				onclick={savePreset}>{m.video_editor_keyframe_preset_save()}</button
			>
			{#if presetSaveError}
				<span class="text-[9px] font-medium text-[oklch(0.85_0.25_25)]" role="alert"
					>{presetSaveError}</span
				>
			{/if}
		</div>
	{/if}
</div>

<style>
	@media (pointer: coarse) {
		[data-segment-menu] :global(button),
		[data-segment-menu] :global([role='slider']) {
			min-height: 44px;
			min-width: 44px;
		}
	}
</style>
