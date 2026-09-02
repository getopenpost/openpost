<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons';

	interface Props {
		label: string;
		savingLabel?: string;
		saving?: boolean;
		disabled?: boolean;
		type?: 'button' | 'submit';
		onSave?: () => void;
	}

	let {
		label,
		savingLabel = label,
		saving = false,
		disabled = false,
		type = 'button',
		onSave
	}: Props = $props();
</script>

<footer data-slot="settings-form-footer" class="flex justify-end border-t pt-4">
	<Button {type} onclick={onSave} disabled={disabled || saving}>
		{#if saving}
			<ProtectedIcon icon="loading" class="size-4 animate-spin" />
			{savingLabel}
		{:else}
			<ThemeIcon role="save" class="size-4" />
			{label}
		{/if}
	</Button>
</footer>
