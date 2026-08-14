<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/stores';
	import { client } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import ComposeTextPost from '$lib/components/compose-text-post.svelte';
	import { Button } from '$lib/components/ui/button';
	import PageLoading from '$lib/components/page-loading.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { m } from '$lib/paraglide/messages';

	type PostDetailResponse = components['schemas']['PostDetailResponse'];
	type PostDetail = Omit<PostDetailResponse, 'media' | 'destinations'> & {
		media: NonNullable<PostDetailResponse['media']>;
		destinations: NonNullable<PostDetailResponse['destinations']>;
	};

	let post = $state<PostDetail | null>(null);
	let hasLoaded = $state(false);
	let error = $state('');
	let requestedPostId = $state('');
	let postRequestSequence = 0;

	const postId = $derived($page.params.id);

	async function loadPost(id: string) {
		const requestSequence = ++postRequestSequence;
		hasLoaded = false;
		error = '';
		try {
			const { data, error: err } = await client.GET('/posts/{id}', {
				params: { path: { id } }
			});
			if (err) throw new Error(err.detail || m.post_edit_load_failed());
			if (requestSequence !== postRequestSequence || postId !== id) return;
			if (data?.publication_id) {
				await goto(resolve(`/publications/${encodeURIComponent(data.publication_id)}` as '/'), {
					replaceState: true
				});
				return;
			}
			post = data
				? { ...data, media: data.media ?? [], destinations: data.destinations ?? [] }
				: null;
		} catch (e) {
			if (requestSequence !== postRequestSequence || postId !== id) return;
			error = (e as Error).message;
			if (!hasLoaded) post = null;
		} finally {
			if (requestSequence === postRequestSequence && postId === id) hasLoaded = true;
		}
	}

	$effect(() => {
		if (postId && postId !== requestedPostId) {
			requestedPostId = postId;
			loadPost(postId);
		}
	});

	async function handleSuccess() {
		await goto(resolve('/'));
	}
</script>

<svelte:head>
	<title>{post ? m.post_edit_title() : m.post_edit_loading_title()} - {m.common_openpost()}</title>
</svelte:head>

{#if !hasLoaded}
	<div class="flex flex-1 flex-col" aria-busy="true">
		<PageLoading layout="composer" label={m.post_edit_loading()} />
	</div>
{:else if error && !post}
	<div class="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
		<InlineNotice tone="error" message={error}>
			{#snippet actions()}
				<Button size="sm" onclick={() => postId && loadPost(postId)}>{m.common_retry()}</Button>
				<Button variant="outline" size="sm" onclick={() => goto(resolve('/'))}>
					{m.common_back()}
				</Button>
			{/snippet}
		</InlineNotice>
	</div>
{:else if post}
	<div class="flex flex-1 flex-col overflow-hidden">
		{#if error}
			<InlineNotice tone="error" message={error} class="mx-4 mt-3" />
		{/if}

		<ComposeTextPost initialPost={post} onSuccess={handleSuccess} onDeleted={handleSuccess} />
	</div>
{/if}
