<script lang="ts">
	import { sequenceStore } from '../sequences/sequence-store.svelte';
	import { m } from '$lib/paraglide/messages';
	import { ProtectedIcon } from '$lib/themes/icons';
	import type { KeyframeProperty, TimelineItem } from '../project/types';
	import { timelineStore } from '../timeline/stores/timeline-store.svelte';
	import { editorKeyframes } from '../timeline/keyframe-editor';
	import { keyframeValueAt } from '../timeline/keyframe-value';
	import { canSetKeyframeAt, setKeyframe, removeKeyframe } from '../timeline/actions/keyframes';
	import { executeAtomic } from '../timeline/commands/command-store.svelte';

	let {
		items,
		property,
		label,
		onedit
	}: { items: TimelineItem[]; property: KeyframeProperty; label: string; onedit: () => void } =
		$props();
	const keys = $derived(items.map((item) => editorKeyframes(item, property)));
	const atPlayhead = $derived(
		items.length > 0 &&
			items.every((item, index) =>
				keys[index].some((key) => key.frame === timelineStore.currentFrame - item.from)
			)
	);
	const animated = $derived(keys.some((track) => track.length > 0));
	const editable = $derived(
		items.length > 0 && items.every((item) => canSetKeyframeAt(item.id, timelineStore.currentFrame))
	);
	const title = $derived(
		atPlayhead
			? m.video_editor_effects_keyframe_remove({ parameter: label })
			: m.video_editor_effects_keyframe_add({ parameter: label })
	);

	function toggle(): void {
		if (!editable) return;
		const remove = atPlayhead;
		let changed = false;
		executeAtomic('TOGGLE_PROPERTY_KEYFRAME', () => {
			for (const item of items) {
				const frame = timelineStore.currentFrame - item.from;
				changed =
					(remove
						? removeKeyframe(item.id, property, frame)
						: setKeyframe(
								item.id,
								property,
								frame,
								keyframeValueAt(item, property, timelineStore.currentFrame, {
									width: sequenceStore.activeWidth,
									height: sequenceStore.activeHeight
								})
							)) || changed;
			}
		});
		if (changed) onedit();
	}
</script>

<button
	type="button"
	class:active={animated}
	class="grid size-6 shrink-0 place-items-center rounded text-[var(--video-editor-muted)] transition-colors hover:bg-[var(--video-editor-control-hover)] focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)] disabled:opacity-35 [&.active]:text-[var(--video-editor-primary)] [@media(pointer:coarse)]:size-11"
	aria-label={title}
	{title}
	aria-pressed={atPlayhead}
	disabled={!editable}
	onclick={toggle}
>
	<ProtectedIcon icon="editor-keyframe" class={`size-2.5 ${atPlayhead ? 'fill-current' : ''}`} />
</button>
