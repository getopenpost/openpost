<script lang="ts">
	import LayersIcon from '@lucide/svelte/icons/layers-3';
	import PaletteIcon from '@lucide/svelte/icons/palette';
	import ScissorsIcon from '@lucide/svelte/icons/scissors';
	import { m } from '$lib/paraglide/messages';
	import type { EditorWorkspaceId } from '$lib/video-editor/workspaces/editor-workspace.svelte';

	let {
		value,
		onchange
	}: { value: EditorWorkspaceId; onchange: (workspace: EditorWorkspaceId) => void } = $props();

	const workspaces = [
		{ id: 'edit', label: m.video_editor_workspace_edit, icon: ScissorsIcon },
		{ id: 'color', label: m.video_editor_workspace_color, icon: PaletteIcon },
		{ id: 'motion', label: m.video_editor_workspace_motion, icon: LayersIcon }
	] as const;

	function focusWorkspace(index: number): void {
		const workspace = workspaces[index];
		if (!workspace) return;
		onchange(workspace.id);
		requestAnimationFrame(() => {
			document.getElementById(`editor-workspace-tab-${workspace.id}`)?.focus();
		});
	}

	function handleKeydown(event: KeyboardEvent, index: number): void {
		if (event.key === 'ArrowRight') {
			event.preventDefault();
			focusWorkspace((index + 1) % workspaces.length);
		} else if (event.key === 'ArrowLeft') {
			event.preventDefault();
			focusWorkspace((index - 1 + workspaces.length) % workspaces.length);
		} else if (event.key === 'Home') {
			event.preventDefault();
			focusWorkspace(0);
		} else if (event.key === 'End') {
			event.preventDefault();
			focusWorkspace(workspaces.length - 1);
		}
	}
</script>

<div
	role="tablist"
	aria-label={m.video_editor_workspaces()}
	class="flex shrink-0 items-center gap-0.5 rounded-md bg-[oklch(0.19_0.01_55)] p-0.5"
>
	{#each workspaces as workspace, index (workspace.id)}
		<button
			id={`editor-workspace-tab-${workspace.id}`}
			type="button"
			role="tab"
			aria-selected={value === workspace.id}
			aria-label={workspace.label()}
			tabindex={value === workspace.id ? 0 : -1}
			class="flex h-11 min-w-11 items-center justify-center gap-1.5 rounded px-2 text-xs font-medium text-[oklch(0.66_0.015_55)] hover:text-white focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] aria-selected:bg-[oklch(0.28_0.018_55)] aria-selected:text-white sm:px-3 md:h-7 md:min-w-8 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-11"
			onclick={() => onchange(workspace.id)}
			onkeydown={(event) => handleKeydown(event, index)}
		>
			<workspace.icon class="size-3.5" aria-hidden="true" />
			<span class="hidden sm:inline">{workspace.label()}</span>
		</button>
	{/each}
</div>
