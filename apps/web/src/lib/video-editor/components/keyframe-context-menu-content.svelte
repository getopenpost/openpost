<script lang="ts">
	import * as ContextMenu from '$lib/components/ui/context-menu';
	import { m } from '$lib/paraglide/messages';
	import { formatShortcutBinding } from '$lib/video-editor/settings/keyboard-shortcuts';
	import { keyboardShortcuts } from '$lib/video-editor/settings/keyboard-shortcuts.svelte';

	let {
		selectedCount,
		clipboardAvailable,
		keyframeCount,
		oncopy,
		oncut,
		onpaste,
		ondelete,
		onselectall,
		onfit
	}: {
		selectedCount: number;
		clipboardAvailable: boolean;
		keyframeCount: number;
		oncopy: () => void;
		oncut: () => void;
		onpaste: () => void;
		ondelete: () => void;
		onselectall: () => void;
		onfit?: () => void;
	} = $props();
</script>

<ContextMenu.Content class="video-editor-theme w-60">
	<ContextMenu.Item disabled={selectedCount === 0} onclick={oncopy}>
		{m.video_editor_keyframe_sheet_copy()}
		<ContextMenu.Shortcut
			>{formatShortcutBinding(keyboardShortcuts.bindings.COPY)}</ContextMenu.Shortcut
		>
	</ContextMenu.Item>
	<ContextMenu.Item disabled={selectedCount === 0} onclick={oncut}>
		{m.video_editor_keyframe_sheet_cut()}
		<ContextMenu.Shortcut
			>{formatShortcutBinding(keyboardShortcuts.bindings.CUT)}</ContextMenu.Shortcut
		>
	</ContextMenu.Item>
	<ContextMenu.Item disabled={!clipboardAvailable} onclick={onpaste}>
		{m.video_editor_keyframe_sheet_paste()}
		<ContextMenu.Shortcut
			>{formatShortcutBinding(keyboardShortcuts.bindings.PASTE)}</ContextMenu.Shortcut
		>
	</ContextMenu.Item>
	<ContextMenu.Separator />
	<ContextMenu.Item disabled={keyframeCount === 0} onclick={onselectall}>
		{m.video_editor_shortcuts_command_graph_select_all()}
		<ContextMenu.Shortcut
			>{formatShortcutBinding(keyboardShortcuts.bindings.GRAPH_SELECT_ALL)}</ContextMenu.Shortcut
		>
	</ContextMenu.Item>
	{#if onfit}
		<ContextMenu.Item onclick={onfit}>
			{m.video_editor_keyframe_graph_fit()}
			<ContextMenu.Shortcut
				>{formatShortcutBinding(keyboardShortcuts.bindings.KEYFRAME_FIT)}</ContextMenu.Shortcut
			>
		</ContextMenu.Item>
	{/if}
	<ContextMenu.Separator />
	<ContextMenu.Item variant="destructive" disabled={selectedCount === 0} onclick={ondelete}>
		{m.common_delete()}
		<ContextMenu.Shortcut
			>{formatShortcutBinding(keyboardShortcuts.bindings.DELETE_SELECTED)}</ContextMenu.Shortcut
		>
	</ContextMenu.Item>
</ContextMenu.Content>
