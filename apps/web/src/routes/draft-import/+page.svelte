<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolveAppPath } from '$lib/app-path';
	import { Button } from '$lib/components/ui/button';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { m } from '$lib/paraglide/messages';
	import { readToolDraft, storeToolDraft } from '$lib/composer/tool-draft-storage';
	import {
		draftTransferMessageSchema,
		draftTransferOrigin,
		draftTransferTimeoutMS
	} from '@openpost/draft-transfer';
	import { z } from 'zod';

	let failed = $state(false);
	let receiving = false;
	const token = $derived(page.url.searchParams.get('token') ?? '');
	function openComposer() {
		const destination = `/?tool_draft=${encodeURIComponent(token)}`;
		void goto(resolveAppPath(`/login?redirect=${encodeURIComponent(destination)}`));
	}

	onMount(() => {
		if (!z.uuid().safeParse(token).success) {
			failed = true;
			return;
		}
		let disposed = false;
		let saved = false;
		const opener = window.opener;
		const ready = () => {
			if (!saved) opener?.postMessage({ type: 'openpost:tool-ready', token }, draftTransferOrigin);
		};
		const receive = async (event: MessageEvent) => {
			if (
				!opener ||
				event.origin !== draftTransferOrigin ||
				event.source !== opener ||
				receiving ||
				saved
			)
				return;
			const parsed = draftTransferMessageSchema.safeParse(event.data);
			if (!parsed.success || parsed.data.token !== token) return;
			receiving = true;
			try {
				await storeToolDraft(token, parsed.data.draft);
				saved = true;
				if (disposed) return;
				opener.postMessage({ type: 'openpost:tool-saved', token }, draftTransferOrigin);
				openComposer();
			} catch {
				failed = true;
				opener.postMessage({ type: 'openpost:tool-error', token }, draftTransferOrigin);
			} finally {
				receiving = false;
			}
		};
		window.addEventListener('message', receive);
		const interval = window.setInterval(ready, 1000);
		const timeout = window.setTimeout(() => {
			if (!saved) failed = true;
		}, draftTransferTimeoutMS);
		void readToolDraft(token)
			.then((draft) => {
				if (disposed) return;
				if (draft) {
					saved = true;
					openComposer();
				} else if (!opener) failed = true;
				else ready();
			})
			.catch(() => {
				failed = true;
			});
		return () => {
			disposed = true;
			window.clearInterval(interval);
			window.clearTimeout(timeout);
			window.removeEventListener('message', receive);
		};
	});
</script>

<svelte:head
	><title>{m.tool_draft_opening()} | OpenPost</title><meta
		name="robots"
		content="noindex"
	/></svelte:head
>
<div class="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-4 px-4 py-12">
	{#if failed}
		<InlineNotice tone="error" message={m.tool_draft_transfer_failed()} />
		<Button href="https://openpo.st/tools" variant="outline">{m.tool_draft_back_to_tools()}</Button>
	{:else}
		<p role="status">{m.tool_draft_opening()}</p>
	{/if}
</div>
