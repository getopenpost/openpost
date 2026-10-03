<script lang="ts">
	import { portableVideoProjectDocument } from '@openpost/video-project';
	import { compareRevisionItems, sameRevisionValue } from '$lib/revision-comparison';
	import { m } from '$lib/paraglide/messages';
	import type { Project } from '../project/types';

	let { current, document }: { current: Project; document: Project } = $props();
	const changes = $derived.by(() => {
		const before = portableVideoProjectDocument(current);
		const after = portableVideoProjectDocument(document);
		const {
			name: beforeName,
			metadata: beforeMetadata,
			duration: beforeDuration,
			timeline: beforeTimeline,
			id: _beforeID,
			createdAt: _beforeCreated,
			updatedAt: _beforeUpdated,
			...beforeSettings
		} = before;
		const {
			name: afterName,
			metadata: afterMetadata,
			duration: afterDuration,
			timeline: afterTimeline,
			id: _afterID,
			createdAt: _afterCreated,
			updatedAt: _afterUpdated,
			...afterSettings
		} = after;
		const {
			tracks: beforeTracks = [],
			items: beforeItems = [],
			compositions: beforeSequences = [],
			...beforeTimelineSettings
		} = beforeTimeline ?? {};
		const {
			tracks: afterTracks = [],
			items: afterItems = [],
			compositions: afterSequences = [],
			...afterTimelineSettings
		} = afterTimeline ?? {};
		return {
			title: beforeName !== afterName,
			canvas: !sameRevisionValue(beforeMetadata, afterMetadata),
			duration: beforeDuration !== afterDuration,
			tracks: compareRevisionItems(beforeTracks, afterTracks),
			items: compareRevisionItems(beforeItems, afterItems),
			sequences: compareRevisionItems(beforeSequences, afterSequences),
			settings:
				!sameRevisionValue(beforeSettings, afterSettings) ||
				!sameRevisionValue(beforeTimelineSettings, afterTimelineSettings)
		};
	});
	const hasChanges = $derived(
		changes.title ||
			changes.canvas ||
			changes.duration ||
			changes.settings ||
			[changes.tracks, changes.items, changes.sequences].some(
				(value) => value.added || value.removed || value.changed
			)
	);
</script>

<div class="min-w-0 space-y-3 border-t pt-3">
	<p class="text-xs text-muted-foreground">{m.video_editor_history_comparison()}</p>
	<dl class="grid min-w-0 gap-2 text-sm">
		<div>
			<dt class="text-xs text-muted-foreground">{m.video_editor_project_name()}</dt>
			<dd class="break-words">{document.name}</dd>
		</div>
		{#if document.description}
			<div>
				<dt class="text-xs text-muted-foreground">{m.video_editor_project_description_label()}</dt>
				<dd class="break-words whitespace-pre-wrap">{document.description}</dd>
			</div>
		{/if}
		<div>
			<dt class="text-xs text-muted-foreground">{m.video_editor_project_canvas()}</dt>
			<dd>{document.metadata.width} × {document.metadata.height}</dd>
		</div>
		<div>
			<dt class="text-xs text-muted-foreground">{m.video_editor_project_frame_rate()}</dt>
			<dd>{document.metadata.fps}</dd>
		</div>
	</dl>
	<h4 class="text-sm font-medium">{m.version_changes()}</h4>
	<ul class="space-y-1 text-sm">
		{#if !hasChanges}<li>{m.version_no_changes()}</li>{/if}
		{#if changes.title}<li>{m.version_change_title()}</li>{/if}
		{#if changes.canvas}<li>{m.version_change_canvas()}</li>{/if}
		{#if changes.duration}<li>{m.version_change_duration()}</li>{/if}
		{#if changes.settings}<li>{m.video_editor_history_settings_changed()}</li>{/if}
		{#if changes.tracks.added || changes.tracks.removed || changes.tracks.changed}
			<li>{m.video_editor_history_track_changes(changes.tracks)}</li>
		{/if}
		{#if changes.items.added || changes.items.removed || changes.items.changed}
			<li>{m.version_change_timeline(changes.items)}</li>
		{/if}
		{#if changes.sequences.added || changes.sequences.removed || changes.sequences.changed}
			<li>{m.video_editor_history_sequence_changes(changes.sequences)}</li>
		{/if}
	</ul>
	{#if document.timeline}
		<details class="text-sm">
			<summary
				class="cursor-pointer rounded-sm py-1 focus-visible:outline-2 focus-visible:outline-ring [@media(pointer:coarse)]:min-h-11"
				>{m.video_editor_details()}</summary
			>
			<ul class="mt-2 max-h-48 space-y-1 overflow-y-auto break-words">
				{#each document.timeline.tracks as track (track.id)}<li>{track.name}</li>{/each}
				{#each document.timeline.items as item (item.id)}<li>{item.label}</li>{/each}
				{#each document.timeline.compositions ?? [] as sequence (sequence.id)}
					<li>
						{sequence.name}
						<ul class="pl-3">
							{#each sequence.items as item (item.id)}<li>{item.label}</li>{/each}
						</ul>
					</li>
				{/each}
			</ul>
		</details>
	{/if}
</div>
