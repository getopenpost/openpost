<script lang="ts">
	import { cn } from '$lib/utils';

	let {
		label,
		pressed = false,
		disabled = false,
		ariaLabel,
		onchange,
		class: className = ''
	}: {
		label: string;
		pressed?: boolean;
		disabled?: boolean;
		ariaLabel?: string;
		onchange?: (pressed: boolean) => void;
		class?: string;
	} = $props();
</script>

<!-- Stage-active toggle shared by the audio panels. aria-pressed carries the
     state, so the label stays a quiet value (On/Off) rather than an action. -->
<button
	type="button"
	class={cn(
		'inline-flex h-[var(--editor-22,22px)] min-w-11 items-center justify-center rounded border px-2 text-xs focus-visible:outline-2 focus-visible:outline-[var(--video-editor-focus)] [@media(pointer:coarse)]:h-11',
		pressed
			? 'border-transparent bg-[var(--video-editor-primary)] text-[var(--video-editor-primary-text)]'
			: 'border-[var(--video-editor-border)] bg-[var(--video-editor-panel)] text-[var(--video-editor-muted)]',
		className
	)}
	aria-pressed={pressed}
	aria-label={ariaLabel}
	{disabled}
	onclick={() => onchange?.(!pressed)}
	data-editor-toggle-pill
>
	{label}
</button>
