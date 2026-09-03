<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { ProtectedIcon, ThemeIcon, type ProtectedIconRole } from '$lib/themes/icons';
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

	const protectedIcon = $derived<ProtectedIconRole>(
		tone === 'error'
			? 'error'
			: tone === 'success'
				? 'success'
				: tone === 'warning'
					? 'warning'
					: 'info'
	);
	const toneClass = $derived(
		tone === 'error'
			? 'border-destructive/20 bg-destructive/10 text-destructive'
			: tone === 'success'
				? 'border-success-foreground/20 bg-success text-success-foreground'
				: tone === 'warning'
					? 'border-warning-foreground/25 bg-warning text-warning-foreground'
					: 'border-info-foreground/20 bg-info text-info-foreground'
	);
</script>

<div
	data-slot="inline-notice"
	class={cn('flex items-center gap-3 rounded-md border px-3 py-2.5 text-sm', toneClass, className)}
	role={tone === 'error' ? 'alert' : 'status'}
	aria-live={tone === 'error' ? 'assertive' : 'polite'}
>
	<div class="flex min-w-0 flex-1 items-start gap-3">
		<ProtectedIcon icon={protectedIcon} class="mt-0.5 size-4 shrink-0" />
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
			<ThemeIcon role="close" class="size-4" />
		</Button>
	{/if}
</div>
