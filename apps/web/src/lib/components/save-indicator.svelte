<script lang="ts">
	import { cn } from '$lib/utils';
	import { ProtectedIcon } from '$lib/themes/icons';

	interface Props {
		saving: boolean;
		saved: boolean;
		savingLabel: string;
		savedLabel: string;
		class?: string;
		testId?: string;
	}

	let { saving, saved, savingLabel, savedLabel, class: className, testId }: Props = $props();
</script>

<span
	class={cn(
		'flex min-w-0 shrink-0 items-center gap-1.5 px-2 text-xs text-muted-foreground',
		!(saving || saved) && 'invisible',
		className
	)}
	role="status"
	aria-live="polite"
	aria-atomic="true"
	data-testid={testId}
	data-state={saving ? 'saving' : saved ? 'saved' : 'idle'}
>
	{#if saving}
		<ProtectedIcon icon="loading" class="size-3.5 shrink-0 animate-spin" />
		<span class="whitespace-nowrap max-sm:sr-only">{savingLabel}</span>
	{:else}
		<ProtectedIcon icon="success" class="size-3.5 shrink-0 text-primary" />
		<span class="whitespace-nowrap max-sm:sr-only">{savedLabel}</span>
	{/if}
</span>
