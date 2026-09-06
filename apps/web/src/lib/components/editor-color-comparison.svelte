<script lang="ts">
	import { Slider } from '$lib/components/ui/slider';
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons';
	import type { EditorColorComparisonMode } from '$lib/editor-color-grade/controls';

	let {
		mode,
		disabled = false,
		showSplit = false,
		splitPosition = 0.5,
		ariaLabel,
		afterLabel,
		beforeLabel,
		splitLabel,
		splitPositionLabel = splitLabel,
		onmodechange,
		onsplitpositionchange = () => undefined
	}: {
		mode: EditorColorComparisonMode;
		disabled?: boolean;
		showSplit?: boolean;
		splitPosition?: number;
		ariaLabel: string;
		afterLabel: string;
		beforeLabel: string;
		splitLabel?: string;
		splitPositionLabel?: string;
		onmodechange: (mode: EditorColorComparisonMode) => void;
		onsplitpositionchange?: (position: number) => void;
	} = $props();

	const options = $derived(
		showSplit
			? ([
					{ id: 'after', label: afterLabel, icon: 'after' },
					{ id: 'before', label: beforeLabel, icon: 'before' },
					{ id: 'split', label: splitLabel ?? '', icon: 'split' }
				] as const)
			: ([
					{ id: 'after', label: afterLabel, icon: 'after' },
					{ id: 'before', label: beforeLabel, icon: 'before' }
				] as const)
	);
</script>

<div>
	<div
		class="grid overflow-hidden rounded border border-[var(--video-editor-border,var(--border))]"
		class:grid-cols-3={showSplit}
		class:grid-cols-2={!showSplit}
		role="group"
		aria-label={ariaLabel}
	>
		{#each options as option, index (option.id)}
			<button
				type="button"
				class="flex min-h-9 items-center justify-center gap-1 px-2 text-xs [@media(pointer:coarse)]:min-h-11"
				class:border-l={index > 0}
				class:border-[var(--video-editor-border,var(--border))]={index > 0}
				class:bg-[var(--video-editor-primary,var(--secondary))]={mode === option.id}
				class:text-[var(--video-editor-primary-text,var(--secondary-foreground))]={mode ===
					option.id}
				class:hover:bg-[var(--video-editor-control,var(--muted))]={mode !== option.id}
				disabled={option.id !== 'after' && disabled}
				aria-pressed={mode === option.id}
				onclick={() => onmodechange(option.id)}
			>
				{#if option.icon === 'before'}
					<ProtectedIcon icon="editor-compare" class="size-3" />
				{:else if option.icon === 'split'}
					<ThemeIcon role="layout" class="size-3" />
				{:else}
					<ThemeIcon role="eye" class="size-3" />
				{/if}
				{option.label}
			</button>
		{/each}
	</div>
	{#if showSplit && mode === 'split'}
		<label class="mt-1 grid grid-cols-[auto_1fr_auto] items-center gap-2 text-[10px]">
			<span>{beforeLabel}</span>
			<Slider
				min={0.05}
				max={0.95}
				step={0.01}
				value={splitPosition}
				ariaLabel={splitPositionLabel}
				onValueChange={onsplitpositionchange}
				onValueCommit={onsplitpositionchange}
			/>
			<span>{afterLabel}</span>
		</label>
	{/if}
</div>
