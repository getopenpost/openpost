<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import { autoKeyframeStore } from '$lib/video-editor/timeline/stores/auto-keyframe-store.svelte';
	import { emitEditorSound } from '$lib/video-editor/sounds/editor-sounds';
	import KeyframeDopesheet from './keyframe-dopesheet.svelte';
	import PropertyRuntimePanel from './property-runtime-panel.svelte';
	import KeyframeValueGraph from './keyframe-value-graph.svelte';
	import AppSelect from '$lib/components/app-select.svelte';
	import { Input } from '$lib/components/ui/input';
	import {
		activeValueAt,
		setKeyframe,
		setKeyframeEasing
	} from '$lib/video-editor/timeline/actions/keyframes';
	import { resolvePreExpressionItemAt } from '$lib/video-editor/timeline/animated-properties';
	import { editorKeyframes } from '$lib/video-editor/timeline/keyframe-editor';
	import {
		isPathVertexKeyframeProperty,
		pathVertexPropertyValue
	} from '$lib/video-editor/timeline/path-vertex-keyframes';
	import { effectPropertyBaseValue } from '$lib/video-editor/effects/effect-keyframes';
	import { BEZIER_PRESETS, buildEasingConfig } from '$lib/video-editor/timeline/easing-presets';
	import {
		easingConfigFromPreset,
		loadCustomEasingPresets,
		presetFromEasing,
		saveCustomEasingPresets,
		suggestedCustomPresetName,
		upsertCustomEasingPreset,
		type CustomEasingPreset
	} from '$lib/video-editor/timeline/custom-easing-presets';
	import {
		adjacentKeyframe,
		keyframeShortcutScopeActive,
		type KeyframeEditorMode
	} from '$lib/video-editor/timeline/keyframe-shortcuts';
	import { fitKeyframeSpanToViewport } from '$lib/video-editor/timeline/timeline-viewport';
	import type { EditorShortcutId } from '$lib/video-editor/settings/keyboard-shortcuts';
	import type {
		EasingConfig,
		EasingType,
		KeyframeProperty,
		TimelineItem
	} from '$lib/video-editor/project/types';

	let {
		selectedItem,
		keyframesOpen,
		selectedKeyframe = $bindable(null),
		keyframeEditorMode = $bindable('dopesheet'),
		pendingKeyframeProperty = $bindable('opacity'),
		availableKeyframeProperties,
		keyframeLabel,
		pxPerFrame,
		timelineWidth,
		timelineX,
		scrollContainer,
		trackHeaderWidth,
		setCurrentFrame,
		onedit
	}: {
		selectedItem: TimelineItem;
		keyframesOpen: boolean;
		selectedKeyframe: { property: KeyframeProperty; frame: number } | null;
		keyframeEditorMode: KeyframeEditorMode;
		pendingKeyframeProperty: KeyframeProperty;
		availableKeyframeProperties: KeyframeProperty[];
		keyframeLabel: (property: KeyframeProperty) => string;
		pxPerFrame: number;
		timelineWidth: number;
		timelineX: (frame: number) => number;
		scrollContainer: HTMLDivElement | null;
		trackHeaderWidth: number;
		setCurrentFrame: (frame: number) => void;
		onedit: () => void;
	} = $props();

	const fps = $derived(editorSession.fps);
	let keyframeShortcutPointerInside = $state(false);
	let keyframeGraphFitRequest = $state(0);
	let customEasingPresets = $state<CustomEasingPreset[]>([]);
	let selectedCustomPresetName = $state('');
	let customPresetName = $state('');
	let presetSelectionKey = '';
	const BEZIER_KEYS = ['x1', 'y1', 'x2', 'y2'] satisfies Array<'x1' | 'y1' | 'x2' | 'y2'>;
	const SPRING_KEYS = ['tension', 'friction', 'mass'] satisfies Array<
		'tension' | 'friction' | 'mass'
	>;

	const selectedEditorKeyframes = $derived(
		selectedItem && selectedKeyframe ? editorKeyframes(selectedItem, selectedKeyframe.property) : []
	);
	const selectedKeyframeIndex = $derived(
		selectedKeyframe
			? selectedEditorKeyframes.findIndex((keyframe) => keyframe.frame === selectedKeyframe?.frame)
			: -1
	);
	const selectedEditorKeyframe = $derived(selectedEditorKeyframes[selectedKeyframeIndex]);
	const selectedEasing = $derived(
		selectedKeyframeIndex >= 0 ? (selectedEditorKeyframe?.easing ?? 'linear') : 'linear'
	);
	const selectedEasingConfig = $derived(
		selectedKeyframeIndex >= 0 ? selectedEditorKeyframe?.easingConfig : undefined
	);
	const pendingEditorKeyframes = $derived(
		selectedItem ? editorKeyframes(selectedItem, pendingKeyframeProperty) : []
	);
	const customPresetOptions = $derived([
		{ value: '', label: m.video_editor_keyframe_custom_presets() },
		...customEasingPresets
			.filter((preset) =>
				selectedEasing === 'spring' ? preset.type === 'Spring' : preset.type === 'Easing'
			)
			.map((preset) => ({ value: preset.name, label: preset.name }))
	]);
	const suggestedPresetName = $derived(suggestedCustomPresetName(customEasingPresets));

	onMount(() => {
		customEasingPresets = loadCustomEasingPresets();
	});

	$effect(() => {
		const nextKey = selectedKeyframe
			? `${selectedKeyframe.property}:${selectedKeyframe.frame}`
			: '';
		if (nextKey === presetSelectionKey) return;
		presetSelectionKey = nextKey;
		selectedCustomPresetName = '';
		customPresetName = '';
	});

	const easingOptions = $derived([
		{ value: 'linear', label: m.video_editor_keyframe_easing_linear() },
		{ value: 'hold', label: m.video_editor_keyframe_easing_hold() },
		{ value: 'ease-in', label: m.video_editor_keyframe_easing_in() },
		{ value: 'ease-out', label: m.video_editor_keyframe_easing_out() },
		{ value: 'ease-in-out', label: m.video_editor_keyframe_easing_in_out() },
		{ value: 'cubic-bezier', label: m.video_editor_keyframe_easing_bezier() },
		{ value: 'spring', label: m.video_editor_keyframe_easing_spring() }
	]);
	function bezierPresetLabel(value: string): string {
		switch (value) {
			case 'soft':
				return m.video_editor_keyframe_bezier_soft();
			case 'ease-out':
				return m.video_editor_keyframe_easing_out();
			case 'ease-in':
				return m.video_editor_keyframe_easing_in();
			case 'ease-in-out':
				// fallow-ignore-next-line code-duplication
				return m.video_editor_keyframe_easing_in_out();
			case 'overshoot':
				return m.video_editor_keyframe_bezier_overshoot();
			case 'snap':
				return m.video_editor_keyframe_bezier_snap();
			case 'out-cubic':
				return m.video_editor_keyframe_bezier_out_cubic();
			case 'out-quart':
				return m.video_editor_keyframe_bezier_out_quart();
			case 'out-quint':
				return m.video_editor_keyframe_bezier_out_quint();
			case 'out-expo':
				return m.video_editor_keyframe_bezier_out_expo();
			case 'out-circ':
				return m.video_editor_keyframe_bezier_out_circ();
			case 'in-out-cubic':
				return m.video_editor_keyframe_bezier_in_out_cubic();
			case 'in-out-quart':
				return m.video_editor_keyframe_bezier_in_out_quart();
			case 'in-out-expo':
				return m.video_editor_keyframe_bezier_in_out_expo();
			case 'in-cubic':
				return m.video_editor_keyframe_bezier_in_cubic();
			case 'in-quart':
				return m.video_editor_keyframe_bezier_in_quart();
			case 'in-expo':
				return m.video_editor_keyframe_bezier_in_expo();
			default:
				return value;
		}
	}
	const bezierOptions = $derived([
		{ value: '', label: m.video_editor_keyframe_bezier_custom() },
		...BEZIER_PRESETS.map((preset) => ({
			value: preset.value,
			label: bezierPresetLabel(preset.value)
		}))
	]);

	export function addKeyframeAtPlayhead(property: KeyframeProperty): void {
		const item = selectedItem;
		if (!item) return;
		if (
			timelineStore.currentFrame < item.from ||
			timelineStore.currentFrame >= item.from + item.durationInFrames
		)
			return;
		const frame = timelineStore.currentFrame - item.from;
		const resolved = resolvePreExpressionItemAt(item, timelineStore.currentFrame);
		const transformValue = transformKeyframeValue(resolved, property);
		const pathValue = isPathVertexKeyframeProperty(property)
			? pathVertexPropertyValue(resolved.pathVertices, property)
			: undefined;
		const value =
			transformValue ??
			pathValue ??
			activeValueAt(item, property, timelineStore.currentFrame) ??
			effectPropertyBaseValue(item, property) ??
			(property === 'opacity' || property === 'volume' ? 1 : 0);
		if (setKeyframe(item.id, property, frame, value)) onedit();
	}

	function transformKeyframeValue(
		item: TimelineItem,
		property: KeyframeProperty
	): number | undefined {
		switch (property) {
			case 'x':
			case 'y':
			case 'width':
			case 'height':
			case 'scaleX':
			case 'scaleY':
			case 'anchorX':
			case 'anchorY':
			case 'rotation':
			case 'opacity':
			case 'cornerRadius':
				return item.transform?.[property];
			default:
				return undefined;
		}
	}

	function commitEasing(easing: EasingType, config?: EasingConfig): void {
		if (!selectedItem || !selectedKeyframe) return;
		if (
			setKeyframeEasing(
				selectedItem.id,
				selectedKeyframe.property,
				selectedKeyframe.frame,
				easing,
				config ?? buildEasingConfig(easing, selectedEasingConfig)
			)
		)
			onedit();
	}

	function commitBezier(key: 'x1' | 'y1' | 'x2' | 'y2', value: number): void {
		const bezier = {
			x1: 0.42,
			y1: 0,
			x2: 0.58,
			y2: 1,
			...selectedEasingConfig?.bezier,
			[key]: value
		};
		commitEasing('cubic-bezier', { type: 'cubic-bezier', bezier });
	}

	function commitSpring(key: 'tension' | 'friction' | 'mass', value: number): void {
		const spring = {
			tension: 170,
			friction: 26,
			mass: 1,
			...selectedEasingConfig?.spring,
			[key]: value
		};
		commitEasing('spring', { type: 'spring', spring });
	}

	function easingFromValue(value: string): EasingType {
		switch (value) {
			case 'hold':
			case 'ease-in':
			case 'ease-out':
			case 'ease-in-out':
			case 'cubic-bezier':
			case 'spring':
				return value;
			default:
				return 'linear';
		}
	}

	export function setPendingKeyframeProperty(value: string): void {
		const property = availableKeyframeProperties.find((candidate) => candidate === value);
		if (property) pendingKeyframeProperty = property;
	}

	export function setKeyframeEditorMode(value: string): void {
		if (value === 'graph' || value === 'dopesheet' || value === 'split') {
			keyframeEditorMode = value;
		}
	}

	function fitKeyframeDopesheet(): void {
		if (!scrollContainer || !selectedItem) return;
		const item = selectedItem;
		const { level, targetScrollLeft } = fitKeyframeSpanToViewport({
			frames: pendingEditorKeyframes.map((keyframe) => item.from + keyframe.frame),
			fallbackFrom: item.from,
			fallbackTo: item.from + item.durationInFrames - 1,
			fps,
			availableWidth: Math.max(1, scrollContainer.clientWidth - trackHeaderWidth - 50),
			scrollBase: trackHeaderWidth
		});
		timelineStore._setZoomLevel(level);
		queueMicrotask(() => {
			if (scrollContainer) scrollContainer.scrollLeft = targetScrollLeft;
		});
	}

	export function fitActiveKeyframeView(): void {
		if (keyframeEditorMode !== 'graph') fitKeyframeDopesheet();
		if (keyframeEditorMode !== 'dopesheet') keyframeGraphFitRequest += 1;
	}

	export function handleKeyframeEditorShortcut(
		event: KeyboardEvent,
		matches: (...ids: EditorShortcutId[]) => boolean
	): boolean {
		if (
			!keyframesOpen ||
			!selectedItem ||
			!keyframeShortcutScopeActive(event.target, keyframeShortcutPointerInside)
		)
			return false;
		let handled = true;
		if (matches('KEYFRAME_EDITOR_GRAPH')) keyframeEditorMode = 'graph';
		else if (matches('KEYFRAME_EDITOR_DOPESHEET')) keyframeEditorMode = 'dopesheet';
		else if (matches('KEYFRAME_EDITOR_SPLIT')) keyframeEditorMode = 'split';
		else if (matches('EDIT_KEYFRAME_ADD')) addKeyframeAtPlayhead(pendingKeyframeProperty);
		else if (matches('KEYFRAME_PREVIOUS', 'KEYFRAME_NEXT')) {
			const keyframe = adjacentKeyframe(
				pendingEditorKeyframes,
				timelineStore.currentFrame - selectedItem.from,
				matches('KEYFRAME_PREVIOUS') ? 'previous' : 'next'
			);
			if (keyframe) {
				selectedKeyframe = { property: keyframe.property, frame: keyframe.frame };
				setCurrentFrame(selectedItem.from + keyframe.frame);
			}
		} else if (matches('KEYFRAME_TOGGLE_AUTO')) {
			const enabled = autoKeyframeStore.toggle(selectedItem.id, pendingKeyframeProperty);
			emitEditorSound(enabled ? 'toggleOn' : 'toggleOff', editorSession.clock.isPlaying);
		} else if (matches('KEYFRAME_FIT')) fitActiveKeyframeView();
		else handled = false;
		if (handled) event.preventDefault();
		return handled;
	}

	function applyBezierPreset(value: string): void {
		const preset = BEZIER_PRESETS.find((candidate) => candidate.value === value);
		if (preset)
			commitEasing('cubic-bezier', {
				type: 'cubic-bezier',
				bezier: preset.points
			});
	}

	function applyCustomPreset(value: string): void {
		const preset = customEasingPresets.find((candidate) => candidate.name === value);
		if (!preset) return;
		const config = easingConfigFromPreset(preset);
		selectedCustomPresetName = preset.name;
		customPresetName = preset.name;
		commitEasing(config.type, config);
	}

	function saveCustomPreset(): void {
		const preset = presetFromEasing(customPresetName, selectedEasingConfig);
		if (!preset) return;
		customEasingPresets = upsertCustomEasingPreset(customEasingPresets, preset);
		saveCustomEasingPresets(customEasingPresets);
		selectedCustomPresetName = preset.name;
		customPresetName = preset.name;
	}

	function deleteCustomPreset(): void {
		if (!selectedCustomPresetName) return;
		customEasingPresets = customEasingPresets.filter(
			(preset) => preset.name !== selectedCustomPresetName
		);
		saveCustomEasingPresets(customEasingPresets);
		selectedCustomPresetName = '';
		customPresetName = '';
	}

	function bezierValue(key: 'x1' | 'y1' | 'x2' | 'y2'): number {
		return selectedEasingConfig?.bezier?.[key] ?? { x1: 0.42, y1: 0, x2: 0.58, y2: 1 }[key];
	}

	function springValue(key: 'tension' | 'friction' | 'mass'): number {
		return selectedEasingConfig?.spring?.[key] ?? { tension: 170, friction: 26, mass: 1 }[key];
	}
</script>

<div
	class="relative bg-[var(--timeline-track)]"
	role="group"
	aria-label={m.video_editor_keyframe_view()}
	data-keyframe-shortcuts
	onpointerenter={() => (keyframeShortcutPointerInside = true)}
	onpointerleave={() => (keyframeShortcutPointerInside = false)}
>
	{#if keyframeEditorMode !== 'graph'}
		<KeyframeDopesheet
			item={selectedItem}
			availableProperties={availableKeyframeProperties}
			currentFrame={timelineStore.currentFrame}
			pixelsPerFrame={pxPerFrame}
			{timelineWidth}
			{timelineX}
			onscrub={setCurrentFrame}
			onselect={(keyframe) =>
				(selectedKeyframe = keyframe
					? { property: keyframe.property, frame: keyframe.frame }
					: null)}
			onactiveproperty={(property) => (pendingKeyframeProperty = property)}
			{onedit}
		/>
	{/if}
	{#if keyframeEditorMode !== 'dopesheet'}
		<KeyframeValueGraph
			item={selectedItem}
			property={pendingKeyframeProperty}
			currentFrame={timelineStore.currentFrame}
			onscrub={setCurrentFrame}
			onselect={(keyframe) =>
				(selectedKeyframe = keyframe
					? { property: keyframe.property, frame: keyframe.frame }
					: null)}
			{onedit}
			fitRequest={keyframeGraphFitRequest}
		/>
	{/if}
	<PropertyRuntimePanel
		item={selectedItem}
		items={timelineStore.items}
		availableProperties={availableKeyframeProperties}
		currentFrame={timelineStore.currentFrame}
		fps={timelineStore.fps}
		{onedit}
	/>
	{#if selectedKeyframe && selectedKeyframeIndex >= 0}
		<div
			class="flex min-h-10 flex-wrap items-center gap-2 border-t border-[var(--video-editor-border)] px-2 py-1 text-xs"
		>
			<span class="font-medium capitalize">{keyframeLabel(selectedKeyframe.property)}</span>
			<label class="flex items-center gap-1">
				{m.video_editor_keyframe_easing()}
				<AppSelect
					class="h-7 w-28 text-xs"
					value={selectedEasing}
					options={easingOptions}
					onValueChange={(value) => commitEasing(easingFromValue(value))}
				/>
			</label>
			{#if selectedEasing === 'cubic-bezier'}
				<AppSelect
					class="h-7 w-32 text-xs"
					value=""
					options={bezierOptions}
					ariaLabel={m.video_editor_keyframe_bezier_preset()}
					onValueChange={applyBezierPreset}
				/>
				{#each BEZIER_KEYS as key (key)}<label
						>{key}<Input
							class="ml-0.5 w-14 rounded bg-[var(--video-editor-field)] px-1 py-0.5 text-[var(--video-editor-field-text)]"
							type="number"
							step="0.01"
							min={key === 'x1' || key === 'x2' ? 0 : -2}
							max={key === 'x1' || key === 'x2' ? 1 : 3}
							value={bezierValue(key)}
							onchange={(event) => commitBezier(key, event.currentTarget.valueAsNumber)}
						/></label
					>{/each}
			{:else if selectedEasing === 'spring'}
				{#each SPRING_KEYS as key (key)}<label
						>{key}<Input
							class="ml-0.5 w-14 rounded bg-[var(--video-editor-field)] px-1 py-0.5 text-[var(--video-editor-field-text)]"
							type="number"
							step={key === 'tension' || key === 'friction' ? 1 : 0.1}
							min={key === 'tension' || key === 'friction' ? 1 : 0.1}
							max={key === 'tension' ? 1000 : key === 'friction' ? 100 : 10}
							value={springValue(key)}
							onchange={(event) => commitSpring(key, event.currentTarget.valueAsNumber)}
						/></label
					>{/each}
			{/if}
			{#if selectedEasing === 'cubic-bezier' || selectedEasing === 'spring'}
				<div class="flex items-center gap-1 border-l border-[var(--video-editor-border)] pl-2">
					<AppSelect
						class="h-7 w-32 text-xs"
						value={selectedCustomPresetName}
						options={customPresetOptions}
						ariaLabel={m.video_editor_keyframe_custom_presets()}
						onValueChange={applyCustomPreset}
					/>
					<Input
						class="h-7 w-28 rounded bg-[var(--video-editor-field)] px-1 text-[var(--video-editor-field-text)]"
						value={customPresetName}
						placeholder={suggestedPresetName}
						aria-label={m.video_editor_keyframe_preset_name()}
						oninput={(event) => (customPresetName = event.currentTarget.value)}
					/>
					<button
						type="button"
						class="h-7 rounded border border-[var(--video-editor-border)] px-2 font-medium hover:bg-[var(--video-editor-control-hover)] disabled:opacity-35 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
						disabled={!customPresetName.trim()}
						onclick={saveCustomPreset}>{m.video_editor_keyframe_preset_save()}</button
					>
					{#if selectedCustomPresetName}
						<button
							type="button"
							class="h-7 rounded px-2 text-[oklch(0.72_0.1_28)] hover:bg-[oklch(0.3_0.08_28_/_0.22)] [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
							onclick={deleteCustomPreset}>{m.video_editor_keyframe_preset_delete()}</button
						>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>
