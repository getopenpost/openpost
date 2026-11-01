<script lang="ts">
	import { ProtectedIcon } from '$lib/themes/icons';
	import { cn } from '$lib/utils';
	import ActionLabel, { type ActionFace } from './action-label.svelte';

	interface Props {
		saving: boolean;
		saved: boolean;
		savingLabel: string;
		savedLabel: string;
		class?: string;
		testId?: string;
		iconOnly?: boolean;
	}

	let {
		saving,
		saved,
		savingLabel,
		savedLabel,
		class: className,
		testId,
		iconOnly = false
	}: Props = $props();
	const faces: ActionFace[] = $derived([
		{ id: 'saving', label: savingLabel, status: 'loading' },
		{ id: 'saved', label: savedLabel, status: 'success' }
	]);
	const state = $derived(saving ? 'saving' : saved ? 'saved' : 'idle');
</script>

<span
	class={cn(
		'flex min-w-0 shrink-0 items-center gap-1.5 px-2 text-xs text-muted-foreground',
		!(saving || saved) && 'invisible',
		iconOnly && 'px-0',
		className
	)}
	role="status"
	aria-live="polite"
	aria-atomic="true"
	data-testid={testId}
	data-state={state}
	title={iconOnly ? (saving ? savingLabel : saved ? savedLabel : undefined) : undefined}
>
	<span class="sr-only">{saving ? savingLabel : saved ? savedLabel : ''}</span>
	{#if iconOnly}
		{#if saving}
			<ProtectedIcon icon="loading" class="size-3.5 animate-spin motion-reduce:animate-none" />
		{:else if saved}
			<ProtectedIcon icon="success" class="size-3.5" />
		{/if}
	{:else}
		<ActionLabel {faces} active={saving ? 'saving' : 'saved'} compact />
	{/if}
</span>
