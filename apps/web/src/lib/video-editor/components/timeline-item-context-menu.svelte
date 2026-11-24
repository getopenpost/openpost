<!--
	Timeline context menu entries for clip items: compound, trim, edit tools,
	captions, grades, joins, clipboard, linking and deletion. Selection-wide
	availability is computed by the panel because keyboard shortcuts share it.
-->
<script lang="ts">
	import * as ContextMenu from '$lib/components/ui/context-menu';
	import { m } from '$lib/paraglide/messages';
	import { formatShortcutBinding } from '@openpost/editor-shared/settings';
	import { keyboardShortcuts } from '$lib/video-editor/settings/keyboard-shortcuts.svelte';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { mediaPool } from '$lib/video-editor/media/pool.svelte';
	import { canExtractEmbeddedSubtitles } from '$lib/video-editor/media/embedded-subtitle-service';
	import { getTextItemPlainText } from '$lib/video-editor/typography/text-item-spans';
	import { hasColorGrade } from '$lib/video-editor/effects/color-grade';
	import { colorPreviewStore } from '$lib/video-editor/effects/color-preview-store.svelte';
	import {
		canTrimItemToPlayhead,
		trimItemToPlayhead
	} from '$lib/video-editor/timeline/actions/trim-playhead';
	import { isTrackEffectivelyLocked } from '$lib/video-editor/timeline/utils/track-groups';
	import { joinableItemNeighbors } from '$lib/video-editor/timeline/join-items';
	import { canDetachAudio } from '../timeline/actions/detach-audio';
	import type { CaptionConsolidationOptions } from '$lib/video-editor/timeline/actions/captions';
	import type { TimelineItem } from '$lib/video-editor/project/types';
	import type { SceneScanMode } from '$lib/video-editor/media/scene-scan';

	let {
		itemIds,
		primaryId,
		canFreeze,
		canJoinSelection,
		canLinkSelection,
		canUnlinkSelection,
		bentoAvailable,
		captionConsolidationTarget,
		clearableKeyframeCount,
		lockedAnimatedSelectionCount,
		freezeFramePending,
		sceneScanPending,
		transcriptionPendingItemIds,
		aiCaptionPendingItemIds,
		onedit,
		onopencomposition,
		ondissolvecompound,
		oncreatecompound,
		onreverseitems,
		onsplitscenes,
		onopenspeechcleanup,
		oncreatevoice,
		ontranscribecaptions,
		onaicaptions,
		onextractsubtitles,
		oncopygrade,
		onpastegrade,
		onfreezeframe,
		onaddcrossfade,
		oncutselection,
		oncopyselection,
		onsplitselection,
		ondeleteselection,
		onrippledeleteselection,
		onconsolidatecaptions,
		onjoinitems,
		onjoinselection,
		onopenbento,
		onclearkeyframes,
		ondetachaudio,
		onlinkselection,
		onunlinkselection
	}: {
		itemIds: string[];
		primaryId: string;
		canFreeze: boolean;
		canJoinSelection: boolean;
		canLinkSelection: boolean;
		canUnlinkSelection: boolean;
		bentoAvailable: boolean;
		captionConsolidationTarget: CaptionConsolidationOptions | null;
		clearableKeyframeCount: number;
		lockedAnimatedSelectionCount: number;
		freezeFramePending: boolean;
		sceneScanPending: boolean;
		transcriptionPendingItemIds: readonly string[];
		aiCaptionPendingItemIds: readonly string[];
		onedit: () => void;
		onopencomposition: (compositionId: string) => void;
		ondissolvecompound: (itemId: string) => void;
		oncreatecompound: (itemIds: string[]) => void;
		onreverseitems: (itemIds: string[], isReversed: boolean) => void;
		onsplitscenes: (itemId: string, mode: SceneScanMode) => void;
		onopenspeechcleanup: (mode: 'fillers' | 'silence', itemIds: string[]) => void;
		oncreatevoice: (itemId: string, text: string) => void;
		ontranscribecaptions: (itemId: string) => void;
		onaicaptions: (itemId: string) => void;
		onextractsubtitles: (itemId: string) => void;
		oncopygrade: (itemId: string) => void;
		onpastegrade: (itemIds: string[]) => void;
		onfreezeframe: (itemId: string) => void;
		onaddcrossfade: () => void;
		oncutselection: () => boolean;
		oncopyselection: () => boolean;
		onsplitselection: () => void;
		ondeleteselection: () => void;
		onrippledeleteselection: () => void;
		onconsolidatecaptions: () => void;
		onjoinitems: (itemIds: string[]) => void;
		onjoinselection: () => void;
		onopenbento: () => void;
		onclearkeyframes: () => void;
		ondetachaudio: (itemId: string) => void;
		onlinkselection: () => void;
		onunlinkselection: () => void;
	} = $props();

	const primaryItem = $derived(timelineStore.itemById.get(primaryId));
	const primaryMedia = $derived(
		primaryItem?.mediaId ? mediaPool.get(primaryItem.mediaId) : undefined
	);
	const transcriptionPendingSet = $derived(new Set(transcriptionPendingItemIds));
	const aiCaptionPendingSet = $derived(new Set(aiCaptionPendingItemIds));
	const hasTranscriptCaptions = $derived(
		primaryItem
			? timelineStore.items.some(
					(item) =>
						item.captionSource?.type === 'transcript' &&
						item.captionSource.clipId === primaryItem.id
				)
			: false
	);
	const hasAiCaptions = $derived(
		primaryItem
			? timelineStore.items.some(
					(item) =>
						item.captionSource?.type === 'ai-captions' &&
						item.captionSource.clipId === primaryItem.id
				)
			: false
	);
	const canManageCaptions = $derived(
		Boolean(
			primaryItem &&
			(primaryItem.type === 'video' || primaryItem.type === 'audio') &&
			primaryItem.mediaId &&
			primaryItem.isReversed !== true &&
			!isTrackEffectivelyLocked(primaryItem.trackId, timelineStore.tracks) &&
			(primaryItem.type !== 'audio' ||
				!timelineStore.items.some(
					(item) =>
						item.type === 'video' &&
						item.mediaId === primaryItem.mediaId &&
						item.linkedGroupId !== undefined &&
						item.linkedGroupId === primaryItem.linkedGroupId
				))
		)
	);
	const canExtractSubtitles = $derived(
		canManageCaptions && primaryMedia !== undefined && canExtractEmbeddedSubtitles(primaryMedia)
	);
	const items = $derived(
		itemIds
			.map((id) => timelineStore.itemById.get(id))
			.filter((item): item is TimelineItem => item !== undefined)
	);
	const mediaItemIds = $derived(
		items.filter((item) => item.type === 'video' || item.type === 'audio').map((item) => item.id)
	);
	const voiceText = $derived(
		primaryItem?.type === 'text' ? getTextItemPlainText(primaryItem).trim() : ''
	);
	const hasPrimaryEditTools = $derived(
		primaryItem?.type === 'video' ||
			primaryItem?.type === 'audio' ||
			(primaryItem?.type === 'text' && voiceText.length > 0) ||
			captionConsolidationTarget !== null
	);
	const gradeSourceItem = $derived(items.find((item) => hasColorGrade(item.effects)));
	const gradeTargetItemIds = $derived(
		items.filter((item) => item.type !== 'audio').map((item) => item.id)
	);
	const hasGradeActions = $derived(
		gradeSourceItem !== undefined ||
			(Boolean(colorPreviewStore.gradeClipboard?.length) && gradeTargetItemIds.length > 0)
	);
	const hasEditTools = $derived(hasPrimaryEditTools || hasGradeActions);
	const itemsEditable = $derived(
		itemIds.some((id) => {
			const item = timelineStore.itemById.get(id);
			return item && !isTrackEffectivelyLocked(item.trackId, timelineStore.tracks);
		})
	);
	const itemsAllEditable = $derived(
		items.length > 0 &&
			items.every((item) => !isTrackEffectivelyLocked(item.trackId, timelineStore.tracks))
	);
	const mediaItemsEditable = $derived(
		items.some(
			(item) =>
				(item.type === 'video' || item.type === 'audio') &&
				!isTrackEffectivelyLocked(item.trackId, timelineStore.tracks)
		)
	);
	const joinableNeighbors = $derived.by(() => {
		if (!primaryItem || isTrackEffectivelyLocked(primaryItem.trackId, timelineStore.tracks)) {
			return {};
		}
		return joinableItemNeighbors(timelineStore.items, primaryItem);
	});
	const crossfadeAvailable = $derived.by(() => {
		if (!primaryItem || isTrackEffectivelyLocked(primaryItem.trackId, timelineStore.tracks))
			return false;
		const neighbors = (timelineStore.itemsByTrackId.get(primaryItem.trackId) ?? [])
			.filter((other) => other.from >= primaryItem.from + primaryItem.durationInFrames - 1)
			.sort((a, b) => a.from - b.from);
		const next = neighbors[0];
		return Boolean(next && !isTrackEffectivelyLocked(next.trackId, timelineStore.tracks));
	});
	const hasClipActions = $derived(
		Boolean(
			primaryItem ||
			canJoinSelection ||
			bentoAvailable ||
			captionConsolidationTarget ||
			clearableKeyframeCount > 0 ||
			lockedAnimatedSelectionCount > 0
		)
	);

	function trimToPlayhead(edge: 'start' | 'end'): void {
		if (!primaryItem) return;
		if (trimItemToPlayhead(primaryItem.id, edge)) onedit();
	}

	function joinNeighbor(neighborId: string): void {
		if (primaryItem) onjoinitems([primaryItem.id, neighborId]);
	}
</script>

{#if primaryItem?.compositionId}
	<ContextMenu.Item
		onclick={() => {
			if (primaryItem?.compositionId) {
				onopencomposition(primaryItem.compositionId);
			}
		}}
	>
		{m.video_editor_sequence_open()}
	</ContextMenu.Item>
	<ContextMenu.Item disabled={!itemsAllEditable} onclick={() => ondissolvecompound(primaryItem.id)}>
		{m.video_editor_dissolve_compound()}
	</ContextMenu.Item>
{:else if primaryItem}
	<ContextMenu.Item
		disabled={!itemsAllEditable}
		onclick={() => oncreatecompound(items.map((item) => item.id))}
	>
		{m.video_editor_create_compound()}
	</ContextMenu.Item>
{/if}
{#if primaryItem && ['video', 'audio', 'image', 'composition'].includes(primaryItem.type)}
	<ContextMenu.Item
		disabled={!canTrimItemToPlayhead(primaryItem.id, 'start')}
		onSelect={() => trimToPlayhead('start')}
	>
		{m.video_editor_trim_start_playhead()}
	</ContextMenu.Item>
	<ContextMenu.Item
		disabled={!canTrimItemToPlayhead(primaryItem.id, 'end')}
		onSelect={() => trimToPlayhead('end')}
	>
		{m.video_editor_trim_end_playhead()}
	</ContextMenu.Item>
{/if}
{#if hasEditTools}
	<ContextMenu.Sub>
		<ContextMenu.SubTrigger>{m.video_editor_tools()}</ContextMenu.SubTrigger>
		<ContextMenu.SubContent class="video-editor-theme w-56">
			{#if primaryItem?.type === 'video' || primaryItem?.type === 'audio'}
				<ContextMenu.Item
					disabled={!mediaItemsEditable}
					onclick={() => onreverseitems(mediaItemIds, primaryItem?.isReversed !== true)}
				>
					{m.video_editor_clip_reverse()}
					<ContextMenu.Shortcut>
						{primaryItem?.isReversed
							? m.video_editor_clip_reverse_on()
							: m.video_editor_clip_reverse_off()}
					</ContextMenu.Shortcut>
				</ContextMenu.Item>
				{#if primaryItem?.type === 'video'}
					<ContextMenu.Sub>
						<ContextMenu.SubTrigger
							disabled={sceneScanPending ||
								isTrackEffectivelyLocked(primaryItem.trackId, timelineStore.tracks)}
						>
							{m.video_editor_scene_split()}
						</ContextMenu.SubTrigger>
						<ContextMenu.SubContent class="video-editor-theme w-52">
							<ContextMenu.Item onclick={() => onsplitscenes(primaryItem.id, 'fast')}>
								{m.video_editor_scene_split_fast()}
								<ContextMenu.Shortcut>4 fps</ContextMenu.Shortcut>
							</ContextMenu.Item>
							<ContextMenu.Item
								title={m.video_editor_scene_split_adaptive_help()}
								onclick={() => onsplitscenes(primaryItem.id, 'adaptive-lfm')}
							>
								{m.video_editor_scene_split_adaptive()}
								<ContextMenu.Shortcut>{m.video_editor_local()}</ContextMenu.Shortcut>
							</ContextMenu.Item>
						</ContextMenu.SubContent>
					</ContextMenu.Sub>
				{/if}
				<ContextMenu.Separator />
				<ContextMenu.Item onclick={() => onopenspeechcleanup('fillers', mediaItemIds)}>
					{m.video_editor_cleanup_fillers_short()}
				</ContextMenu.Item>
				<ContextMenu.Item onclick={() => onopenspeechcleanup('silence', mediaItemIds)}>
					{m.video_editor_cleanup_silence_short()}
				</ContextMenu.Item>
			{:else if primaryItem?.type === 'text' && voiceText}
				<ContextMenu.Item onclick={() => oncreatevoice(primaryItem.id, voiceText)}>
					{m.video_editor_text_create_voice()}
				</ContextMenu.Item>
			{/if}
			{#if primaryItem && (canManageCaptions || captionConsolidationTarget)}
				<ContextMenu.Sub>
					<ContextMenu.SubTrigger>{m.video_editor_tool_captions()}</ContextMenu.SubTrigger>
					<ContextMenu.SubContent class="video-editor-theme w-60">
						{#if canManageCaptions}
							<ContextMenu.Item
								disabled={transcriptionPendingSet.has(primaryItem.id)}
								onclick={() => ontranscribecaptions(primaryItem.id)}
							>
								{transcriptionPendingSet.has(primaryItem.id)
									? m.video_editor_captions_updating()
									: hasTranscriptCaptions
										? m.video_editor_captions_regenerate()
										: m.video_editor_captions_generate()}
							</ContextMenu.Item>
							<ContextMenu.Item
								disabled={aiCaptionPendingSet.has(primaryItem.id)}
								onclick={() => onaicaptions(primaryItem.id)}
							>
								{aiCaptionPendingSet.has(primaryItem.id)
									? m.video_editor_ai_scene_captions_updating()
									: hasAiCaptions
										? m.video_editor_ai_scene_captions_refresh()
										: m.video_editor_ai_scene_captions_generate()}
							</ContextMenu.Item>
						{/if}
						{#if canExtractSubtitles}
							<ContextMenu.Item onclick={() => onextractsubtitles(primaryItem.id)}>
								{m.video_editor_extract_embedded_subtitles()}
							</ContextMenu.Item>
						{/if}
						{#if captionConsolidationTarget}
							<ContextMenu.Item onclick={onconsolidatecaptions}>
								{m.video_editor_consolidate_captions()}
							</ContextMenu.Item>
						{/if}
					</ContextMenu.SubContent>
				</ContextMenu.Sub>
			{/if}
			{#if hasGradeActions}
				{#if hasPrimaryEditTools}<ContextMenu.Separator />{/if}
				{#if gradeSourceItem}
					<ContextMenu.Item onclick={() => oncopygrade(gradeSourceItem.id)}>
						{m.video_editor_color_copy_grade()}
					</ContextMenu.Item>
				{/if}
				{#if colorPreviewStore.gradeClipboard?.length && gradeTargetItemIds.length > 0}
					<ContextMenu.Item onclick={() => onpastegrade(gradeTargetItemIds)}>
						{m.video_editor_color_paste_grade()}
					</ContextMenu.Item>
				{/if}
			{/if}
		</ContextMenu.SubContent>
	</ContextMenu.Sub>
{/if}
{#if primaryItem?.type === 'video'}
	<ContextMenu.Item
		disabled={!canFreeze || freezeFramePending}
		onclick={() => {
			if (primaryItem) onfreezeframe(primaryItem.id);
		}}
	>
		{m.video_editor_freeze_frame()}
	</ContextMenu.Item>
{/if}
{#if joinableNeighbors.previous}
	<ContextMenu.Item
		onclick={() => {
			const previous = joinableNeighbors.previous;
			if (previous) joinNeighbor(previous.id);
		}}
	>
		{m.video_editor_join_previous()}
		<ContextMenu.Shortcut
			>{formatShortcutBinding(keyboardShortcuts.bindings.JOIN_ITEMS)}</ContextMenu.Shortcut
		>
	</ContextMenu.Item>
{/if}
{#if joinableNeighbors.next}
	<ContextMenu.Item
		onclick={() => {
			const next = joinableNeighbors.next;
			if (next) joinNeighbor(next.id);
		}}
	>
		{m.video_editor_join_next()}
		<ContextMenu.Shortcut
			>{formatShortcutBinding(keyboardShortcuts.bindings.JOIN_ITEMS)}</ContextMenu.Shortcut
		>
	</ContextMenu.Item>
{/if}
{#if canJoinSelection}
	<ContextMenu.Item onclick={onjoinselection}>
		{m.video_editor_join_selected()}
		<ContextMenu.Shortcut
			>{formatShortcutBinding(keyboardShortcuts.bindings.JOIN_ITEMS)}</ContextMenu.Shortcut
		>
	</ContextMenu.Item>
{/if}
<ContextMenu.Item disabled={!crossfadeAvailable} onclick={onaddcrossfade}>
	{m.video_editor_crossfade()}
</ContextMenu.Item>
{#if bentoAvailable}
	<ContextMenu.Item onclick={onopenbento}>
		{m.video_editor_bento_open()}
	</ContextMenu.Item>
{/if}
{#if clearableKeyframeCount > 0 || lockedAnimatedSelectionCount > 0}
	<ContextMenu.Item disabled={clearableKeyframeCount === 0} onclick={onclearkeyframes}>
		{m.video_editor_clear_keyframes_toolbar()}
		<ContextMenu.Shortcut
			>{formatShortcutBinding(keyboardShortcuts.bindings.CLEAR_KEYFRAMES)}</ContextMenu.Shortcut
		>
	</ContextMenu.Item>
{/if}
{#if hasClipActions}<ContextMenu.Separator />{/if}
<ContextMenu.Item onclick={() => oncutselection()}>
	{m.video_editor_shortcuts_command_cut()}
	<ContextMenu.Shortcut
		>{formatShortcutBinding(keyboardShortcuts.bindings.CUT)}</ContextMenu.Shortcut
	>
</ContextMenu.Item>
<ContextMenu.Item onclick={() => oncopyselection()}>
	{m.common_copy()}
	<ContextMenu.Shortcut
		>{formatShortcutBinding(keyboardShortcuts.bindings.COPY)}</ContextMenu.Shortcut
	>
</ContextMenu.Item>
<ContextMenu.Separator />
<ContextMenu.Item disabled={!itemsEditable} onclick={onsplitselection}>
	{m.video_editor_shortcuts_command_split()}
	<ContextMenu.Shortcut
		>{[
			keyboardShortcuts.bindings.SPLIT_AT_PLAYHEAD,
			keyboardShortcuts.bindings.SPLIT_AT_PLAYHEAD_ALT
		]
			.filter(Boolean)
			.map((binding) => formatShortcutBinding(binding))
			.join(' / ')}</ContextMenu.Shortcut
	>
</ContextMenu.Item>
{#if primaryItem && canDetachAudio(primaryItem)}
	<ContextMenu.Item onclick={() => ondetachaudio(primaryItem.id)}
		>{m.video_editor_detach_audio()}</ContextMenu.Item
	>
{/if}
{#if canLinkSelection}
	<ContextMenu.Item onclick={onlinkselection}>{m.video_editor_link_selected()}</ContextMenu.Item>
{:else if canUnlinkSelection}
	<ContextMenu.Item onclick={onunlinkselection}>{m.video_editor_unlink_selected()}</ContextMenu.Item
	>
{/if}
<ContextMenu.Separator />
<ContextMenu.Item variant="destructive" disabled={!itemsEditable} onclick={ondeleteselection}>
	{m.video_editor_delete_leave_gap()}
	<ContextMenu.Shortcut
		>{formatShortcutBinding(keyboardShortcuts.bindings.DELETE_SELECTED)}</ContextMenu.Shortcut
	>
</ContextMenu.Item>
<ContextMenu.Item variant="destructive" disabled={!itemsEditable} onclick={onrippledeleteselection}>
	{m.video_editor_ripple_delete()}
	<ContextMenu.Shortcut
		>{formatShortcutBinding(keyboardShortcuts.bindings.RIPPLE_DELETE)}</ContextMenu.Shortcut
	>
</ContextMenu.Item>
