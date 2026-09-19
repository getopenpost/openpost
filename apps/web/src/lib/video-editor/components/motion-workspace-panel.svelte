<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Disclosure as EditorDisclosure, HintButton } from '$lib/components/editor-density';
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
	import ProjectCanvasPanel from './project-canvas-panel.svelte';

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
	const publishedControlCount = $derived(
		sequenceStore.activeSequence?.compositionControls?.controls.length ?? 0
	);
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
	class="flex size-full min-w-0 shrink-0 flex-col gap-2 overflow-x-hidden overflow-y-auto border-t border-[var(--video-editor-border)] p-2 lg:border-t-0 lg:border-l"
	aria-label={m.video_editor_workspace_motion()}
>
	<h2 class="px-1 text-xs font-medium tracking-wide text-[var(--video-editor-muted)] uppercase">
		{m.video_editor_workspace_motion()}
	</h2>
	{#if activeComposite && canreturncomposition}
		<Button class="w-full" size="sm" variant="ghost" onclick={onreturncomposition}>
			{m.video_editor_motion_return_composition()}
		</Button>
	{/if}

	{#if supportsMotion}
		<ClipPropertiesPanel {itemId} {itemIds} {onedit} />
		<section
			class="rounded-md border border-[var(--video-editor-border)] bg-[var(--video-editor-panel)] p-2"
		>
			<div class="flex items-center gap-1">
				<h3 class="min-w-0 flex-1 truncate text-sm font-medium">
					{m.video_editor_motion_parent_title()}
				</h3>
				<HintButton
					label={m.video_editor_motion_parent_title()}
					hint={m.video_editor_motion_parent_description()}
					class="text-[var(--video-editor-muted)] hover:text-[var(--video-editor-ink)]"
				/>
			</div>
			<label class="mt-2 block text-xs font-medium" for="motion-parent-select">
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
					class="mt-1 h-[25px] w-full justify-between rounded-md border border-[var(--video-editor-border)] bg-[var(--video-editor-panel)] px-2 text-xs shadow-none"
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
		{#if item?.type === 'text'}
			<TextMotionPanel {itemId} {itemIds} {onedit} />
		{/if}
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
	{:else if activeComposite}
		<p class="px-2 py-1.5 text-center text-[11px] text-[var(--video-editor-muted)]" role="status">
			{m.video_editor_motion_select_clip()}
		</p>
	{:else}
		<section
			class="rounded-md border border-[var(--video-editor-border)] bg-[var(--video-editor-panel)] p-2"
		>
			<div class="flex items-start justify-between gap-3">
				<div class="flex min-w-0 items-center gap-1">
					<h3 class="min-w-0 flex-1 truncate text-sm font-medium">
						{m.video_editor_motion_composition_title()}
					</h3>
					<HintButton
						label={m.video_editor_motion_composition_title()}
						hint={m.video_editor_motion_composition_description()}
						class="text-[var(--video-editor-muted)] hover:text-[var(--video-editor-ink)]"
					/>
				</div>
			</div>
			<div class="mt-3 grid grid-cols-1 gap-2">
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
		</section>
	{/if}

	{#if activeComposite}
		<EditorDisclosure
			label={m.video_editor_motion_canvas_settings()}
			class="overflow-hidden rounded-md border border-[var(--video-editor-border)] bg-[var(--video-editor-panel)]"
		>
			<div class="border-t border-[var(--video-editor-border)] p-2">
				<ProjectCanvasPanel {onedit} />
			</div>
		</EditorDisclosure>
		<EditorDisclosure
			label={m.video_editor_motion_published_title({ count: publishedControlCount })}
			class="overflow-hidden rounded-md border border-[var(--video-editor-border)] bg-[var(--video-editor-panel)]"
		>
			<div class="border-t border-[var(--video-editor-border)] p-2">
				<CompositionControlsAuthoring {onedit} />
			</div>
		</EditorDisclosure>
	{/if}
</aside>
