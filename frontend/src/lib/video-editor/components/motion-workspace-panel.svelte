<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Select from '$lib/components/ui/select';
	import { m } from '$lib/paraglide/messages';
	import type { AnimationPreset } from '$lib/video-editor/project/types';
	import { sequenceStore } from '$lib/video-editor/sequences/sequence-store.svelte';
	import { addTransformController } from '$lib/video-editor/timeline/actions/items';
	import {
		detachTransformParent,
		setTransformParent
	} from '$lib/video-editor/timeline/actions/transform-parenting';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import ClipPropertiesPanel from './clip-properties-panel.svelte';
	import MotionPresetsPanel from './motion-presets-panel.svelte';
	import TextMotionPanel from './text-motion-panel.svelte';
	import CompositionControlsAuthoring from './composition-controls-authoring.svelte';

	let {
		itemId,
		itemIds = [],
		frameWidth,
		frameHeight,
		fps,
		animationPresets = [],
		onsavepreset = () => {},
		ondeletepreset = () => {},
		oncreatecomposition = () => {},
		onreturncomposition = () => {},
		canreturncomposition = false,
		onselectitem = () => {},
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
		oncreatecomposition?: () => void;
		onreturncomposition?: () => void;
		canreturncomposition?: boolean;
		onselectitem?: (itemId: string) => void;
		onedit: () => void;
	} = $props();

	const item = $derived(itemId ? timelineStore.itemById.get(itemId) : undefined);
	const supportsMotion = $derived(
		item !== undefined &&
			[
				'video',
				'image',
				'lottie',
				'text',
				'subtitle',
				'shape',
				'composition',
				'controller'
			].includes(item.type)
	);
	const activeComposite = $derived(sequenceStore.activeSequence?.editorKind === 'composite-2d');
	const parentCandidates = $derived(
		timelineStore.items.filter(
			(candidate) =>
				candidate.id !== itemId && candidate.type !== 'audio' && candidate.type !== 'adjustment'
		)
	);
	const canCreateComposition = $derived(
		itemIds.some((id) => {
			const selected = timelineStore.itemById.get(id);
			return selected && selected.type !== 'audio' && selected.type !== 'adjustment';
		})
	);
	let parentError = $state('');

	function createController(): void {
		const id = addTransformController(m.video_editor_motion_controller_default());
		onselectitem(id);
		onedit();
	}

	function changeParent(value: string): void {
		if (!itemId) return;
		parentError = '';
		const parentItemId = value;
		if (!parentItemId) {
			if (detachTransformParent(itemId)) onedit();
			return;
		}
		const result = setTransformParent(itemId, parentItemId);
		if (result.ok) {
			onedit();
			return;
		}
		parentError =
			result.reason === 'cycle'
				? m.video_editor_motion_parent_cycle()
				: result.reason === 'duplicate-transform'
					? m.video_editor_motion_parent_duplicate()
					: m.video_editor_motion_parent_failed();
	}
</script>

<aside
	class="flex max-h-[44dvh] w-full shrink-0 flex-col gap-2 overflow-y-auto border-t border-[oklch(0.25_0.015_55)] p-2 lg:max-h-none lg:w-80 lg:border-t-0 lg:border-l"
	aria-label={m.video_editor_workspace_motion()}
>
	<h2 class="px-1 text-xs font-medium tracking-wide text-[oklch(0.65_0.015_55)] uppercase">
		{m.video_editor_workspace_motion()}
	</h2>
	<section class="rounded-md border border-[oklch(0.28_0.015_55)] bg-[oklch(0.16_0.01_55)] p-3">
		<div class="flex items-start justify-between gap-3">
			<div class="min-w-0">
				<h3 class="text-sm font-medium">{m.video_editor_motion_composition_title()}</h3>
				<p class="mt-1 text-xs leading-5 text-[oklch(0.65_0.015_55)]">
					{m.video_editor_motion_composition_description()}
				</p>
			</div>
			{#if activeComposite}
				<span
					class="shrink-0 rounded-full bg-orange-500/15 px-2 py-1 text-[10px] font-medium text-orange-300"
				>
					{m.video_editor_motion_composite_badge()}
				</span>
			{/if}
		</div>
		<div class="mt-3 grid grid-cols-2 gap-2">
			<Button
				size="sm"
				variant="secondary"
				disabled={!canCreateComposition}
				onclick={oncreatecomposition}
			>
				{m.video_editor_motion_create_composition()}
			</Button>
			<Button size="sm" variant="secondary" onclick={createController}>
				{m.video_editor_motion_add_controller()}
			</Button>
		</div>
		{#if activeComposite && canreturncomposition}
			<Button class="mt-2 w-full" size="sm" variant="ghost" onclick={onreturncomposition}>
				{m.video_editor_motion_return_composition()}
			</Button>
		{/if}
	</section>
	<CompositionControlsAuthoring {onedit} />
	{#if supportsMotion}
		<section class="rounded-md border border-[oklch(0.28_0.015_55)] bg-[oklch(0.16_0.01_55)] p-3">
			<h3 class="text-sm font-medium">{m.video_editor_motion_parent_title()}</h3>
			<p class="mt-1 text-xs leading-5 text-[oklch(0.65_0.015_55)]">
				{m.video_editor_motion_parent_description()}
			</p>
			<label class="mt-3 block text-xs font-medium" for="motion-parent-select">
				{m.video_editor_motion_parent_label()}
			</label>
			<Select.Root
				type="single"
				value={item?.transformParent?.parentItemId ?? ''}
				onValueChange={changeParent}
			>
				<Select.Trigger
					id="motion-parent-select"
					aria-label={m.video_editor_motion_parent_label()}
					class="mt-1 h-9 w-full justify-between rounded-md border border-[oklch(0.3_0.015_55)] bg-[oklch(0.12_0.008_55)] px-2 text-sm shadow-none"
				>
					<span class="truncate"
						>{parentCandidates.find((c) => c.id === item?.transformParent?.parentItemId)?.label ??
							m.video_editor_motion_parent_none()}</span
					>
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="">{m.video_editor_motion_parent_none()}</Select.Item>
					{#each parentCandidates as candidate (candidate.id)}
						<Select.Item value={candidate.id}>{candidate.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			{#if parentError}
				<p class="mt-2 text-xs text-red-300" role="alert">{parentError}</p>
			{/if}
		</section>
		<ClipPropertiesPanel {itemId} {onedit} />
		<MotionPresetsPanel
			{itemId}
			{itemIds}
			{frameWidth}
			{frameHeight}
			{fps}
			{animationPresets}
			{onsavepreset}
			{ondeletepreset}
			{onedit}
		/>
		{#if item?.type === 'text'}
			<TextMotionPanel {itemId} {itemIds} {onedit} />
		{/if}
	{:else}
		<p class="p-3 text-center text-xs text-[oklch(0.65_0.015_55)]">
			{m.video_editor_motion_select_clip()}
		</p>
	{/if}
</aside>
