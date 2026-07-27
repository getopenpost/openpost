<script lang="ts">
	import XIcon from 'lucide-svelte/icons/x';
	import { Button } from '$lib/components/ui/button';

	interface Props {
		message: string;
		onDismiss: () => void;
		dismissLabel: string;
		tone?: 'neutral' | 'success' | 'error';
		actionLabel?: string;
		actionHref?: string;
		onAction?: () => void;
	}

	let {
		message,
		onDismiss,
		dismissLabel,
		tone = 'neutral',
		actionLabel,
		actionHref,
		onAction
	}: Props = $props();

	const toneClasses = {
		neutral: 'border-border bg-popover text-popover-foreground',
		success:
			'border-emerald-600/25 bg-emerald-50 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-50',
		error: 'border-destructive/30 bg-destructive text-destructive-foreground'
	};
</script>

<div
	data-slot="app-toast"
	class="pointer-events-auto fixed right-4 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] left-4 z-50 flex max-w-md items-center gap-3 rounded-lg border px-4 py-3 shadow-lg md:bottom-4 md:left-auto {toneClasses[
		tone
	]}"
	role={tone === 'error' ? 'alert' : 'status'}
	aria-live={tone === 'error' ? 'assertive' : 'polite'}
>
	<span class="min-w-0 flex-1 text-sm">{message}</span>
	{#if actionLabel && actionHref}
		<Button href={actionHref} variant="outline" size="sm">{actionLabel}</Button>
	{:else if actionLabel && onAction}
		<Button onclick={onAction} variant="outline" size="sm">{actionLabel}</Button>
	{/if}
	<Button
		variant="ghost"
		size="icon-sm"
		class="-my-1 -mr-2"
		onclick={onDismiss}
		aria-label={dismissLabel}
	>
		<XIcon class="size-4" />
	</Button>
</div>
