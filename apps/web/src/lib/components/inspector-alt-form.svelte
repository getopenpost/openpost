<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import { m } from '$lib/paraglide/messages';
	import { ProtectedIcon } from '$lib/themes/icons';

	interface Props {
		altText?: string;
		savedAltText: string | null;
		altSaving: boolean;
		canEdit: boolean;
		onSaveAlt: () => void;
	}

	let { altText = $bindable(''), savedAltText, altSaving, canEdit, onSaveAlt }: Props = $props();
</script>

<div class="space-y-2">
	<label for="media-detail-alt-text" class="block text-sm font-medium">
		{m.media_alt_text()}
	</label>
	<Textarea
		id="media-detail-alt-text"
		class="min-h-24 p-3 font-normal"
		bind:value={altText}
		placeholder={m.media_alt_placeholder()}
		disabled={!canEdit || altSaving}
	/>
	{#if canEdit && altText.trim() !== savedAltText}
		<Button size="sm" variant="outline" onclick={onSaveAlt} disabled={altSaving}>
			{#if altSaving}<ProtectedIcon icon="loading" class="animate-spin" />{/if}
			{m.media_save_alt()}
		</Button>
	{/if}
</div>
