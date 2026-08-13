<script lang="ts">
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		open?: boolean;
		title: string;
		description: string;
		confirmLabel?: string;
		cancelLabel?: string;
		onConfirm: () => void | Promise<void>;
	}

	let {
		open = $bindable(false),
		title,
		description,
		confirmLabel = m.common_delete(),
		cancelLabel = m.common_cancel(),
		onConfirm
	}: Props = $props();

	let pending = $state(false);

	async function confirm() {
		if (pending) return;
		pending = true;
		try {
			await onConfirm();
			open = false;
		} finally {
			pending = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content aria-busy={pending} showCloseButton={false} class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>{description}</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button
				variant="outline"
				class="w-full sm:w-auto"
				disabled={pending}
				onclick={() => (open = false)}
			>
				{cancelLabel}
			</Button>
			<Button variant="destructive" class="w-full sm:w-auto" disabled={pending} onclick={confirm}>
				{#if pending}<LoaderIcon class="size-4 animate-spin" />{/if}
				{confirmLabel}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
