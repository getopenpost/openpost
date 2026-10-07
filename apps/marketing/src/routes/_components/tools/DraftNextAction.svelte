<script lang="ts">
	import { onDestroy } from 'svelte';
	import { ArrowRight } from '@lucide/svelte';
	import { Button } from '@openpost/ui/components/button';
	import { appUrl } from '../../_marketing';
	import {
		draftTransferReceiptSchema,
		draftTransferSchema,
		draftTransferTimeoutMS,
		type ToolDraft
	} from '@openpost/draft-transfer';

	let {
		draft,
		label = 'Schedule this post',
		disabled = false
	}: {
		draft: ToolDraft;
		label?: string;
		disabled?: boolean;
	} = $props();
	let busy = $state(false);
	let failure = $state('');
	let cleanup = () => {};
	onDestroy(() => cleanup());

	function continueDraft() {
		cleanup();
		failure = '';
		const parsed = draftTransferSchema.safeParse($state.snapshot(draft));
		if (!parsed.success) {
			failure =
				'This draft could not transfer. Keep at most 100 parts and 250 MB of files, then try again.';
			return;
		}
		const token = crypto.randomUUID();
		const destination = new URL('/draft-import', appUrl);
		destination.searchParams.set('token', token);
		const receiver = window.open(destination.href, '_blank');
		if (!receiver) {
			failure = 'Allow OpenPost to open a new tab, then try again. Your draft is still here.';
			return;
		}
		// Snapshot the reviewed output so editing this tab cannot change an in-flight transfer.
		const snapshot = structuredClone(parsed.data);
		busy = true;
		const timeout = window.setTimeout(() => {
			cleanup();
			failure = 'The draft could not reach OpenPost. Try again. Your draft is still here.';
		}, draftTransferTimeoutMS);
		const receive = (event: MessageEvent) => {
			if (event.origin !== destination.origin || event.source !== receiver) return;
			const parsed = draftTransferReceiptSchema.safeParse(event.data);
			if (!parsed.success || parsed.data.token !== token) return;
			if (parsed.data.type === 'openpost:tool-ready') {
				receiver.postMessage(
					{ type: 'openpost:tool-draft', token, draft: snapshot },
					destination.origin
				);
				return;
			}
			cleanup();
			if (parsed.data.type === 'openpost:tool-error') {
				failure = 'OpenPost could not keep this draft. Try again. Your draft is still here.';
			}
		};
		cleanup = () => {
			window.clearTimeout(timeout);
			window.removeEventListener('message', receive);
			busy = false;
		};
		window.addEventListener('message', receive);
	}
</script>

<div class="mt-5 border-t pt-5" data-agent-exclude="draft-action">
	<Button onclick={continueDraft} disabled={disabled || busy} class="min-h-11">
		{busy ? 'Opening your draft…' : label}<ArrowRight data-icon="inline-end" />
	</Button>
	<p class="mt-2 text-sm leading-6 text-muted-foreground">
		Your draft opens in OpenPost. Choose your accounts, review it, then schedule or publish.
		{#if draft.files.length}Selected files upload to your workspace after sign-in.{/if}
	</p>
	{#if failure}<p role="alert" class="mt-2 text-sm text-destructive">{failure}</p>{/if}
</div>
