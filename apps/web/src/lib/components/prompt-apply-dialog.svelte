<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		open?: boolean;
		example: string;
		onConfirm: () => void;
		onCancel?: () => void;
	}

	let { open = $bindable(false), example, onConfirm, onCancel }: Props = $props();

	function handleOpenChange(next: boolean) {
		open = next;
		if (!next) onCancel?.();
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content showCloseButton={false} class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{m.prompt_apply_replace_title()}</Dialog.Title>
			<Dialog.Description>{m.prompt_apply_replace_body()}</Dialog.Description>
		</Dialog.Header>
		<div class="max-h-48 overflow-y-auto rounded-md border bg-muted/40 p-3">
			<p class="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">{example}</p>
		</div>
		<Dialog.Footer>
			<Button variant="ghost" onclick={() => (open = false)}>{m.prompt_apply_keep_editing()}</Button
			>
			<Button onclick={onConfirm}>{m.prompt_apply_replace()}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
