<!-- Main plus reusable sequence tabs. Double-click a name to rename. -->
<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { tick } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { editorSession } from '$lib/video-editor/editor.svelte';
	import {
		createSequence,
		renameSequence,
		switchSequence
	} from '$lib/video-editor/sequences/sequence-actions';
	import { sequenceStore } from '$lib/video-editor/sequences/sequence-store.svelte';
	import FilmIcon from '@lucide/svelte/icons/film';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';

	let { onswitch, onedit }: { onswitch: () => void; onedit: () => void } = $props();
	let editingId = $state<string | null>(null);
	let draftName = $state('');
	let draggedId = $state<string | null>(null);
	let renameInput = $state<HTMLInputElement | null>(null);

	const tabs = $derived(
		sequenceStore.topLevelSequenceIds.flatMap((id) => {
			const composition = sequenceStore.compositionById.get(id);
			return composition ? [composition] : [];
		})
	);

	function activate(id: string | null): void {
		editorSession.pausePlayback();
		if (!switchSequence(id)) return;
		editorSession.syncTimelineClock();
		onswitch();
	}

	function add(): void {
		const id = createSequence(`${m.video_editor_new_sequence()} ${tabs.length + 1}`);
		onedit();
		activate(id);
	}

	async function beginRename(id: string, name: string): Promise<void> {
		editingId = id;
		draftName = name;
		await tick();
		renameInput?.focus();
		renameInput?.select();
	}

	function commitRename(id: string): void {
		if (renameSequence(id, draftName)) onedit();
		editingId = null;
	}

	function close(id: string): void {
		if (sequenceStore.activeSequenceId === id) activate(null);
		sequenceStore.closeTab(id);
		onedit();
	}

	function reorder(targetId: string): void {
		if (!draggedId || draggedId === targetId) return;
		const from = sequenceStore.topLevelSequenceIds.indexOf(draggedId);
		const to = sequenceStore.topLevelSequenceIds.indexOf(targetId);
		if (sequenceStore.reorderTabs(from, to)) onedit();
		draggedId = null;
	}

	function reorderByKeyboard(event: KeyboardEvent, id: string): void {
		if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
		event.preventDefault();
		const from = sequenceStore.topLevelSequenceIds.indexOf(id);
		const to = from + (event.key === 'ArrowLeft' ? -1 : 1);
		if (sequenceStore.reorderTabs(from, to)) onedit();
	}
</script>

<nav
	class="flex min-w-0 items-center gap-1 overflow-x-auto border-b border-[oklch(0.25_0.015_55)] bg-[oklch(0.16_0.008_55)] px-2 py-1 text-xs"
	aria-label={m.video_editor_sequences()}
>
	<button
		type="button"
		class="flex shrink-0 items-center gap-1.5 rounded px-2.5 py-1 focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] {sequenceStore.activeSequenceId ===
		null
			? 'bg-[oklch(0.26_0.018_55)] text-white'
			: 'text-[oklch(0.68_0.015_55)] hover:bg-[oklch(0.22_0.01_50)] hover:text-white'}"
		onclick={() => activate(null)}
	>
		<FilmIcon class="size-3.5" aria-hidden="true" />
		{m.video_editor_main_sequence()}
	</button>

	{#each tabs as tab (tab.id)}
		<div
			role="group"
			aria-label={tab.name}
			class="group flex shrink-0 items-center rounded {sequenceStore.activeSequenceId === tab.id
				? 'bg-[oklch(0.26_0.018_55)] text-white'
				: 'text-[oklch(0.68_0.015_55)] hover:bg-[oklch(0.22_0.01_50)] hover:text-white'}"
			draggable="true"
			ondragstart={() => (draggedId = tab.id)}
			ondragover={(event) => event.preventDefault()}
			ondrop={() => reorder(tab.id)}
		>
			{#if editingId === tab.id}
				<Input
					bind:ref={renameInput}
					class="mx-2 h-7 w-28 rounded-none border-0 border-b border-[oklch(0.66_0.14_45)] bg-transparent px-0 py-1 text-xs shadow-none focus-visible:ring-0"
					bind:value={draftName}
					onblur={() => commitRename(tab.id)}
					onkeydown={(event) => {
						if (event.key === 'Enter') commitRename(tab.id);
						if (event.key === 'Escape') editingId = null;
					}}
				/>
			{:else}
				<button
					type="button"
					class="max-w-40 truncate py-1 pl-2.5 text-left focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
					title={tab.name}
					onclick={() => activate(tab.id)}
					ondblclick={() => beginRename(tab.id, tab.name)}
					onkeydown={(event) => reorderByKeyboard(event, tab.id)}
				>
					{tab.name}
				</button>
				<button
					type="button"
					class="mx-0.5 rounded p-1 opacity-0 group-hover:opacity-100 hover:bg-white/10 focus:opacity-100 focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
					aria-label={`${m.video_editor_sequence_close()}: ${tab.name}`}
					onclick={() => close(tab.id)}
				>
					<XIcon class="size-3" aria-hidden="true" />
				</button>
			{/if}
		</div>
	{/each}

	<button
		type="button"
		class="shrink-0 rounded p-1.5 text-[oklch(0.68_0.015_55)] hover:bg-[oklch(0.22_0.01_50)] hover:text-white focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
		aria-label={m.video_editor_new_sequence()}
		title={m.video_editor_new_sequence()}
		onclick={add}
	>
		<PlusIcon class="size-3.5" aria-hidden="true" />
	</button>
</nav>
