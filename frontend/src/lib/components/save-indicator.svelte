<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import { cn } from '$lib/utils';

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

{#if saving}
	<span
		class={cn(
			'flex min-w-0 shrink-0 items-center gap-1.5 px-2 text-xs text-muted-foreground',
			className
		)}
		role="status"
		aria-live="polite"
		aria-atomic="true"
		data-testid={testId}
		data-state="saving"
	>
		<LoaderIcon class="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
		<span class="whitespace-nowrap max-sm:sr-only">{savingLabel}</span>
	</span>
{:else if saved}
	<span
		class={cn(
			'flex min-w-0 shrink-0 animate-in items-center gap-1.5 px-2 text-xs text-muted-foreground zoom-in-95 fade-in motion-reduce:animate-none',
			className
		)}
		role="status"
		aria-live="polite"
		aria-atomic="true"
		data-testid={testId}
		data-state="saved"
	>
		<CheckIcon class="size-3.5 shrink-0 text-primary" aria-hidden="true" />
		<span class="whitespace-nowrap max-sm:sr-only">{savedLabel}</span>
	</span>
{/if}
