<script lang="ts">
	import type { Snippet } from 'svelte';
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import CheckCircleIcon from '@lucide/svelte/icons/check-circle-2';
	import InfoIcon from '@lucide/svelte/icons/info';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import XIcon from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button';
	import { cn } from '$lib/utils';

	type NoticeTone = 'error' | 'success' | 'warning' | 'info';

	interface Props {
		tone?: NoticeTone;
		message?: string;
		children?: Snippet;
		actions?: Snippet;
		onDismiss?: () => void;
		dismissLabel?: string;
		class?: string;
	}

	let {
		tone = 'info',
		message,
		children,
		actions,
		onDismiss,
		dismissLabel = 'Dismiss',
		class: className
	}: Props = $props();

	const Icon = $derived(
		tone === 'error'
			? AlertCircleIcon
			: tone === 'success'
				? CheckCircleIcon
				: tone === 'warning'
					? TriangleAlertIcon
					: InfoIcon
	);
	const toneClass = $derived(
		tone === 'error'
			? 'border-destructive/20 bg-destructive/10 text-destructive'
			: tone === 'success'
				? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
				: tone === 'warning'
					? 'border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-200'
					: 'border-border bg-muted/35 text-foreground'
	);
</script>

<div
	data-slot="inline-notice"
	class={cn('flex items-center gap-3 rounded-md border px-3 py-2.5 text-sm', toneClass, className)}
	role={tone === 'error' ? 'alert' : 'status'}
	aria-live={tone === 'error' ? 'assertive' : 'polite'}
>
	<div class="flex min-w-0 flex-1 items-start gap-3">
		<Icon class="mt-0.5 size-4 shrink-0" />
		<div class="min-w-0 flex-1 leading-5">
			{#if message}{message}{/if}
			{#if children}{@render children()}{/if}
		</div>
	</div>
	{#if actions}
		<div class="flex shrink-0 flex-wrap items-center gap-2">{@render actions()}</div>
	{/if}
	{#if onDismiss}
		<Button
			variant="ghost"
			size="icon-sm"
			class="-my-1 -mr-1 shrink-0 text-current hover:text-current"
			onclick={onDismiss}
			aria-label={dismissLabel}
		>
			<XIcon class="size-4" />
		</Button>
	{/if}
</div>
