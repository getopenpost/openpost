<script lang="ts">
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import {
		completeDestructiveAction,
		type DestructiveActionOutcome
	} from '$lib/destructive-action-outcome';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		open?: boolean;
		title: string;
		description: string;
		confirmLabel?: string;
		cancelLabel?: string;
		onConfirm: () => DestructiveActionOutcome | Promise<DestructiveActionOutcome>;
		returnFocus?: HTMLElement | null;
	}

	let {
		open = $bindable(false),
		title,
		description,
		confirmLabel = m.common_delete(),
		cancelLabel = m.common_cancel(),
		onConfirm,
		returnFocus = null
	}: Props = $props();

	let pending = $state(false);
	let failure = $state('');

	$effect(() => {
		if (!open) failure = '';
	});

	async function confirm() {
		if (pending) return;
		pending = true;
		failure = '';
		try {
			const outcome = await onConfirm();
			if (!outcome.ok) {
				failure = outcome.message || m.app_destructive_action_failed();
				return;
			}
			open = false;
			await completeDestructiveAction(outcome, returnFocus);
		} catch (error) {
			failure =
				error instanceof Error && error.message ? error.message : m.app_destructive_action_failed();
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
		{#if failure}<InlineNotice tone="error" message={failure} />{/if}
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
