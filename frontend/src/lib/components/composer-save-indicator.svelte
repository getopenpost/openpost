<script lang="ts">
	import CheckIcon from 'lucide-svelte/icons/check';
	import LoaderIcon from 'lucide-svelte/icons/loader-2';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		saving: boolean;
		saved: boolean;
	}

	let { saving, saved }: Props = $props();
</script>

<span
	class="flex size-5 shrink-0 items-center justify-center text-muted-foreground"
	role="status"
	aria-live="polite"
	aria-atomic="true"
	data-testid="composer-save-indicator"
	data-state={saving ? 'saving' : saved ? 'saved' : 'idle'}
>
	{#if saving}
		<LoaderIcon class="size-3.5 animate-spin" aria-hidden="true" />
		<span class="sr-only">{m.common_saving()}</span>
	{:else if saved}
		<CheckIcon
			class="size-4 animate-in text-primary zoom-in-95 fade-in motion-reduce:animate-none"
			aria-hidden="true"
		/>
		<span class="sr-only">{m.compose_saved_state()}</span>
	{/if}
</span>
