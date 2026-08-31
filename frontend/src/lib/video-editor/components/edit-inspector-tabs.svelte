<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import type { EditInspectorTab } from './edit-inspector-tabs';

	let {
		tabs,
		value = $bindable('properties'),
		onchange = () => {}
	}: {
		tabs: readonly EditInspectorTab[];
		value?: EditInspectorTab;
		onchange?: (tab: EditInspectorTab) => void;
	} = $props();

	function label(tab: EditInspectorTab): string {
		switch (tab) {
			case 'motion':
				return m.video_editor_workspace_motion();
			case 'effects':
				return m.video_editor_effects();
			case 'transcript':
				return m.video_editor_transcript();
			default:
				return m.video_editor_inspector();
		}
	}

	function select(tab: EditInspectorTab): void {
		value = tab;
		onchange(tab);
	}

	function moveFocus(
		event: KeyboardEvent & { currentTarget: HTMLButtonElement },
		current: EditInspectorTab
	): void {
		const currentIndex = tabs.indexOf(current);
		let nextIndex: number | null = null;
		if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
		if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
		if (event.key === 'Home') nextIndex = 0;
		if (event.key === 'End') nextIndex = tabs.length - 1;
		if (nextIndex === null) return;

		const next = tabs[nextIndex];
		if (!next) return;
		event.preventDefault();
		const tablist = event.currentTarget.parentElement;
		select(next);
		requestAnimationFrame(() => {
			tablist?.querySelector<HTMLButtonElement>(`[data-edit-inspector-tab="${next}"]`)?.focus();
		});
	}
</script>

<div
	class="flex shrink-0 gap-1 overflow-x-auto border-t border-b border-[oklch(0.25_0.015_55)] bg-[oklch(0.16_0.008_55)] px-2 py-1"
	role="tablist"
	aria-label={m.video_editor_inspector()}
>
	{#each tabs as tab (tab)}
		<button
			type="button"
			role="tab"
			tabindex={value === tab ? 0 : -1}
			data-edit-inspector-tab={tab}
			aria-selected={value === tab}
			class="min-h-11 shrink-0 rounded px-2.5 text-xs text-[oklch(0.66_0.015_55)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] aria-selected:bg-[oklch(0.66_0.14_45_/_0.16)] aria-selected:text-[oklch(0.84_0.09_55)] lg:min-h-8 [@media(pointer:coarse)]:min-h-11"
			onclick={() => select(tab)}
			onkeydown={(event) => moveFocus(event, tab)}
		>
			{label(tab)}
		</button>
	{/each}
</div>
