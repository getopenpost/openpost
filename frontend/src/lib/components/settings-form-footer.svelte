<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import SaveIcon from '@lucide/svelte/icons/save';

	interface Props {
		label: string;
		savingLabel?: string;
		saving?: boolean;
		disabled?: boolean;
		sticky?: boolean;
		type?: 'button' | 'submit';
		onSave?: () => void;
	}

	let {
		label,
		savingLabel = label,
		saving = false,
		disabled = false,
		sticky = true,
		type = 'button',
		onSave
	}: Props = $props();
</script>

<footer
	data-slot="settings-form-footer"
	class={sticky
		? 'sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] z-10 flex justify-end rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur md:bottom-3'
		: 'flex justify-end rounded-lg border bg-background/95 p-3 shadow-sm'}
>
	<Button {type} onclick={onSave} disabled={disabled || saving}>
		{#if saving}
			<LoaderIcon class="size-4 animate-spin" />
			{savingLabel}
		{:else}
			<SaveIcon class="size-4" />
			{label}
		{/if}
	</Button>
</footer>
