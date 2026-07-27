<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/stores';
	import { client } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import { Button } from '$lib/components/ui/button';
	import PageLoading from '$lib/components/page-loading.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import ComposeFocusedPublication from '$lib/components/compose-focused-publication.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import {
		COMPOSER_MODE_KEYS,
		intentForLegacyProfile,
		type ComposerModeKey
	} from '$lib/components/compose/modes';
	import { m } from '$lib/paraglide/messages';

	type Publication = components['schemas']['PublicationResponse'];

	let publication = $state<Publication | null>(null);
	let hasLoaded = $state(false);
	let error = $state('');
	let requestedPublicationId = $state('');
	let publicationRequestSequence = 0;

	const publicationId = $derived($page.params.id);

	async function loadPublication(id: string) {
		const requestSequence = ++publicationRequestSequence;
		hasLoaded = false;
		error = '';
		try {
			const { data, error: err } = await client.GET('/publications/{id}', {
				params: { path: { id } }
			});
			if (err) throw new Error((err as any)?.detail || m.publication_edit_load_failed());
			if (requestSequence !== publicationRequestSequence || publicationId !== id) return;
			const mode = publicationMode(data);
			if ((mode === 'post' || mode === 'thread') && data.text_post_id) {
				await goto(resolve(`/posts/${encodeURIComponent(data.text_post_id)}` as '/'), {
					replaceState: true
				});
				return;
			}
			publication = data;
		} catch (err) {
			if (requestSequence !== publicationRequestSequence || publicationId !== id) return;
			error = err instanceof Error ? err.message : m.publication_edit_load_failed();
			publication = null;
		} finally {
			if (requestSequence === publicationRequestSequence && publicationId === id) hasLoaded = true;
		}
	}

	function publicationMode(item: Publication): ComposerModeKey {
		if (COMPOSER_MODE_KEYS.includes(item.intent as ComposerModeKey)) {
			return item.intent as ComposerModeKey;
		}
		return intentForLegacyProfile(item.content_profile);
	}

	async function handleSuccess() {
		ui.triggerRefresh();
		goto(resolve('/'));
	}

	function handleCancel() {
		goto(resolve('/'));
	}

	$effect(() => {
		if (publicationId && publicationId !== requestedPublicationId) {
			requestedPublicationId = publicationId;
			loadPublication(publicationId);
		}
	});
</script>

<svelte:head>
	<title
		>{publication ? m.publication_edit_title() : m.publication_edit_loading_title()} - {m.common_openpost()}</title
	>
</svelte:head>

{#if !hasLoaded}
	<div class="flex flex-1 flex-col" aria-busy="true">
		<PageLoading layout="composer" label={m.publication_edit_loading()} />
	</div>
{:else if error && !publication}
	<div class="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
		<InlineNotice tone="error" message={error}>
			{#snippet actions()}
				<Button size="sm" onclick={() => publicationId && loadPublication(publicationId)}>
					{m.common_retry()}
				</Button>
				<Button variant="outline" size="sm" onclick={() => goto(resolve('/'))}>
					{m.common_back()}
				</Button>
			{/snippet}
		</InlineNotice>
	</div>
{:else if publication}
	<div class="flex flex-1 flex-col overflow-hidden">
		<ComposeFocusedPublication
			mode={publicationMode(publication)}
			initialPublication={publication}
			onSuccess={handleSuccess}
			onCancel={handleCancel}
		/>
	</div>
{/if}
