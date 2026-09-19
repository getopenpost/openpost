<script module lang="ts">
	import type { ProtectedIconRole } from '$lib/themes/icons';
	export interface ColorPaletteOption<T extends string = string> {
		id: T;
		label: string;
		icon?: ProtectedIconRole;
	}
</script>

<script lang="ts" generics="T extends string">
	import { tick } from 'svelte';
	import { ProtectedIcon } from '$lib/themes/icons';
	let {
		palettes,
		active,
		label,
		onselect
	}: {
		palettes: readonly ColorPaletteOption<T>[];
		active: T;
		label: string;
		onselect: (palette: T) => void;
	} = $props();
	let tablist: HTMLDivElement;

	$effect(() => {
		void active;
		void tick().then(() => {
			if (!tablist) return;
			tablist
				.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
				?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
		});
	});

	function selectFromKeyboard(event: KeyboardEvent, index: number): void {
		let nextIndex = index;
		if (event.key === 'ArrowLeft') nextIndex = (index - 1 + palettes.length) % palettes.length;
		else if (event.key === 'ArrowRight') nextIndex = (index + 1) % palettes.length;
		else if (event.key === 'Home') nextIndex = 0;
		else if (event.key === 'End') nextIndex = palettes.length - 1;
		else return;

		const next = palettes[nextIndex];
		if (!next) return;
		event.preventDefault();
		onselect(next.id);
		const tablist = (event.currentTarget as HTMLElement).closest('[role="tablist"]');
		const tab = tablist?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex];
		tab?.focus();
	}
</script>

<div class="palette-tabs-shell">
	<div
		bind:this={tablist}
		class="flex min-w-0 items-center gap-0.5 overflow-x-auto"
		role="tablist"
		aria-label={label}
		data-color-palette-tabs
	>
		{#each palettes as palette, index (palette.id)}
			<button
				type="button"
				class="palette-tab"
				class:palette-tab-active={active === palette.id}
				role="tab"
				aria-selected={active === palette.id}
				aria-label={palette.label}
				title={palette.label}
				tabindex={active === palette.id ? 0 : -1}
				onclick={() => onselect(palette.id)}
				onkeydown={(event) => selectFromKeyboard(event, index)}
			>
				{#if palette.icon}<ProtectedIcon icon={palette.icon} class="size-3.5" />{/if}
				<span class:sr-only={!!palette.icon && active !== palette.id}>{palette.label}</span>
			</button>
		{/each}
	</div>
</div>

<style>
	.palette-tabs-shell {
		position: relative;
		min-width: 0;
	}
	@media (max-width: 40rem) {
		.palette-tabs-shell::after {
			position: absolute;
			top: 0;
			right: 0;
			bottom: 0;
			width: 1rem;
			background: linear-gradient(to left, var(--video-editor-panel), transparent);
			content: '';
			pointer-events: none;
		}
	}
	.palette-tab {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		height: 1.5625rem;
		flex: 0 0 auto;
		border-radius: 0.25rem;
		padding-inline: 0.5rem;
		font-size: 0.6875rem;
		font-weight: 500;
		color: var(--video-editor-muted);
	}
	.palette-tab:hover {
		background: var(--video-editor-control-hover);
		color: var(--video-editor-text);
	}
	.palette-tab:focus-visible {
		outline: 2px solid var(--video-editor-focus);
		outline-offset: -2px;
	}
	.palette-tab-active {
		background: var(--video-editor-selection);
		color: var(--video-editor-selection-text);
	}
	@media (pointer: coarse) {
		.palette-tab {
			height: 2.75rem;
			min-width: 2.75rem;
		}
	}
</style>
