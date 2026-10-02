<script lang="ts">
	import { ProtectedIcon } from '$lib/themes/icons';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { m } from '$lib/paraglide/messages';
	import type { ImageEditorRevisionSummary } from '../types';

	let {
		revision,
		canEdit,
		disabled = false,
		onremove
	}: {
		revision: ImageEditorRevisionSummary;
		canEdit: boolean;
		disabled?: boolean;
		onremove: (revision: ImageEditorRevisionSummary) => Promise<void>;
	} = $props();
	let open = $state(false);
	let busy = $state(false);
	let error = $state('');

	async function remove(): Promise<void> {
		if (!canEdit || disabled || busy || revision.kind !== 'checkpoint') return;
		busy = true;
		error = '';
		try {
			await onremove(revision);
			open = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.image_editor_checkpoint_remove_failed();
		} finally {
			busy = false;
		}
	}
</script>

{#if revision.kind === 'checkpoint'}
	<Dialog.Root bind:open>
		<Dialog.Trigger disabled={!canEdit || disabled || busy} onclick={() => (error = '')}>
			{#snippet child({ props })}
				<Button variant="outline" class="w-full" {...props}
					>{m.image_editor_checkpoint_remove()}</Button
				>
			{/snippet}
		</Dialog.Trigger>
		<Dialog.Content
			class="sm:max-w-md"
			showCloseButton={!busy}
			onEscapeKeydown={(event) => {
				if (busy) event.preventDefault();
			}}
			onInteractOutside={(event) => {
				if (busy) event.preventDefault();
			}}
		>
			<Dialog.Header>
				<Dialog.Title>{m.image_editor_checkpoint_remove()}</Dialog.Title>
				<Dialog.Description
					>{m.image_editor_checkpoint_remove_body({
						name: revision.name || ''
					})}</Dialog.Description
				>
			</Dialog.Header>
			{#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
			<Dialog.Footer>
				<Button variant="outline" disabled={busy} onclick={() => (open = false)}
					>{m.common_cancel()}</Button
				>
				<Button
					variant="destructive"
					disabled={!canEdit || disabled || busy}
					onclick={() => void remove()}
					>{#if busy}<ProtectedIcon
							icon="loading"
							class="size-4 animate-spin motion-reduce:animate-none"
						/>{/if}{m.image_editor_checkpoint_remove()}</Button
				>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/if}
