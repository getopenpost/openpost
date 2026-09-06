<script lang="ts">
	import { cn } from '$lib/utils';
	import ActionLabel, { type ActionFace } from './action-label.svelte';

	interface Props {
		saving: boolean;
		saved: boolean;
		savingLabel: string;
		savedLabel: string;
		class?: string;
		testId?: string;
	}

	let { saving, saved, savingLabel, savedLabel, class: className, testId }: Props = $props();
	const faces: ActionFace[] = $derived([
		{ id: 'saving', label: savingLabel, status: 'loading' },
		{ id: 'saved', label: savedLabel, status: 'success' }
	]);
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
	<span class="sr-only">{saving ? savingLabel : saved ? savedLabel : ''}</span>
	<ActionLabel {faces} active={saving ? 'saving' : 'saved'} compact />
</span>
