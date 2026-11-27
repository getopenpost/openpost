<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import type { ScreenshotDocument } from '@openpost/query-catalog';
	import ConversationFields from '$lib/screenshot-templates/conversation-fields.svelte';
	import ReceiptFields from '$lib/screenshot-templates/receipt-fields.svelte';
	import StatusFields from '$lib/screenshot-templates/status-fields.svelte';
	import MemeFields from '$lib/screenshot-templates/meme-fields.svelte';
	import { createPreviewModel, normalizePreviewPlatform } from '@openpost/social-preview';
	import type { SocialAccount } from '$lib/api/client';
	import type { PublicationPostOption } from '$lib/post-builder/client';
	import { renderPostVisual, releasePostVisual, type PostVisual } from '$lib/post-builder/visuals';
	import { getAuthenticatedMediaByID } from '$lib/media-url';
	import { formatSocialAccountName } from '$lib/utils';
	import ComposerPreview from '$lib/components/composer-preview.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { m } from '$lib/paraglide/messages';
	import { openPreviewWindow, type PreviewWindowSession } from '$lib/preview-window';
	import { ThemeIcon } from '$lib/themes/icons';
	let {
		option,
		account,
		workspaceId,
		sources = [],
		busy = false,
		onUse,
		onChange
	}: {
		option: PublicationPostOption;
		account?: SocialAccount;
		workspaceId: string;
		sources?: NonNullable<import('$lib/post-builder/client').PublicationBuildResult['sources']>;
		busy?: boolean;
		onUse: (option: PublicationPostOption) => void;
		onChange: (option: PublicationPostOption) => void;
	} = $props();
	let fullPreview = $state.raw<PreviewWindowSession | null>(null);
	let editing = $state(false);
	let visualEditing = $state(false);
	const visualEditorId = $props.id();
	let visual = $state.raw<PostVisual>();
	let rendering = $state(false);
	let error = $state('');
	let attempt = $state(0);
	let renderSignature = '';
	let renderController: AbortController | undefined;
	const plan = $derived(
		option.destinations.find((destination) => destination.account_id === account?.id)
	);
	const recipeKey = $derived(plan?.media.document ? JSON.stringify(plan.media.document) : '');
	const source = $derived(sources.find((item) => item.id === plan?.media.source_ref));
	const model = $derived(
		createPreviewModel({
			platform: normalizePreviewPlatform(account?.platform ?? ''),
			identity: {
				displayName: account
					? formatSocialAccountName(account.account_username, account.platform, account.alias ?? '')
					: '',
				handle: account?.account_username ?? '',
				avatarUrl: account?.account_avatar_url
			},
			format: plan && plan.segments.length > 1 ? 'thread' : 'post',
			segments: (plan?.segments ?? []).map((segment, i) => ({
				id: `${option.id}-${i}`,
				text: segment.body,
				media:
					i === 0 && visual
						? [
								{
									id: option.id,
									kind: 'image',
									src: visual.url,
									alt: plan?.media.alt_text,
									aspectRatio: visual.aspectRatio
								}
							]
						: i === 0 &&
							  plan?.media.treatment === 'use_source' &&
							  plan.media.source_ref?.startsWith('media:')
							? [
									{
										id: plan.media.source_ref,
										kind: source?.mime_type?.startsWith('video/')
											? 'video'
											: source?.mime_type?.startsWith('audio/')
												? 'document'
												: source?.mime_type?.startsWith('image/')
													? 'image'
													: 'document',
										src: getAuthenticatedMediaByID(plan.media.source_ref.slice(6)),
										alt: plan.media.alt_text
									}
								]
							: []
			}))
		})
	);
	$effect(() => {
		fullPreview?.update(model);
	});
	$effect(() => {
		const key = recipeKey;
		const workspace = workspaceId;
		const signature = JSON.stringify([workspace, key, attempt]);
		untrack(() => {
			if (signature === renderSignature) return;
			renderSignature = signature;
			renderController?.abort();
			const controller = new AbortController();
			renderController = controller;
			if (visual) {
				releasePostVisual(visual);
				visual = undefined;
			}
			error = '';
			const recipe: ScreenshotDocument | undefined = key ? JSON.parse(key) : undefined;
			if (!recipe) {
				rendering = false;
				return;
			}
			rendering = true;
			void renderPostVisual(workspace, recipe, controller.signal)
				.then((result) => {
					if (controller.signal.aborted) {
						releasePostVisual(result);
						return;
					}
					visual = result;
				})
				.catch((cause) => {
					if (!controller.signal.aborted)
						error = cause instanceof Error ? cause.message : m.ideate_visual_failed();
				})
				.finally(() => {
					if (!controller.signal.aborted) rendering = false;
				});
		});
	});
	onDestroy(() => {
		renderController?.abort();
		fullPreview?.close();
		if (visual) releasePostVisual(visual);
	});

	function changeBody(index: number, body: string) {
		if (!plan) return;
		const next = structuredClone($state.snapshot(option));
		const destination = next.destinations.find((item) => item.account_id === plan.account_id);
		if (destination) destination.segments[index].body = body;
		onChange(next);
	}
	function changeVisual(update: Partial<ScreenshotDocument>) {
		if (!plan?.media.document) return;
		const next = structuredClone($state.snapshot(option));
		const destination = next.destinations.find((item) => item.account_id === plan.account_id);
		if (destination) destination.media.document = { ...plan.media.document, ...update };
		onChange(next);
	}
</script>

<article
	class="min-w-0 space-y-3 rounded-xl border border-border bg-card p-3 sm:p-4"
	data-testid="ideate-option"
>
	<header class="flex min-w-0 items-center justify-between gap-2">
		<h2 class="min-w-0 text-sm font-medium">{option.label}</h2>
		<Button
			variant="ghost"
			size="icon"
			onclick={() => (editing = !editing)}
			aria-label={m.ideate_edit_text()}
			title={m.ideate_edit_text()}
			aria-pressed={editing}
			disabled={busy}><ThemeIcon role="edit" class="size-4" /></Button
		>
	</header>
	{#if plan}
		<ComposerPreview {model} />
		{#if rendering}<p class="text-sm text-muted-foreground" role="status">
				{m.ideate_rendering()}
			</p>{/if}
		{#if error}<InlineNotice tone="error" message={error}
				>{#snippet actions()}<Button variant="ghost" size="sm" onclick={() => attempt++}
						>{m.common_retry()}</Button
					>{/snippet}</InlineNotice
			>{/if}
		{#if plan.media.treatment === 'attach_image' || plan.media.treatment === 'attach_video'}
			<div class="rounded-lg border border-dashed p-3 text-sm">
				<p class="font-medium">
					{plan.media.treatment === 'attach_video'
						? m.ideate_video_needed()
						: m.ideate_image_needed()}
				</p>
				<p class="mt-1 text-muted-foreground">{plan.media.brief}</p>
				<p class="mt-2 text-xs text-muted-foreground">{m.ideate_attach_later()}</p>
			</div>
		{/if}
		{#if editing}<div class="grid gap-2">
				{#each plan.segments as segment, i (i)}<label class="grid gap-1 text-xs font-medium"
						>{m.ideate_post_text()}<Textarea
							value={segment.body}
							rows={4}
							oninput={(event) => changeBody(i, event.currentTarget.value)}
							disabled={busy}
						/></label
					>{/each}
			</div>{/if}
	{:else}<p class="text-sm text-muted-foreground">
			{option.skipped?.find((destination) => destination.account_id === account?.id)?.reason ??
				m.ideate_destination_skipped()}
		</p>{/if}
	{#if (option.skipped ?? []).length > 0}<p class="text-xs text-muted-foreground">
			{m.ideate_skipped_count({ count: option.skipped!.length })}
		</p>{/if}
	<div class="flex flex-wrap items-center gap-1">
		{#if plan}<Button
				variant="ghost"
				size="xs"
				class="px-1"
				onclick={() => {
					if (account) {
						fullPreview?.close();
						fullPreview = openPreviewWindow(account.id, model);
					}
				}}>{m.compose_full_preview()}</Button
			>
			{#if plan.media.document}
				<Button
					variant="ghost"
					size="xs"
					class="px-1"
					aria-expanded={visualEditing}
					aria-controls={visualEditorId}
					onclick={() => (visualEditing = !visualEditing)}
					disabled={busy}
				>
					<ThemeIcon role={visualEditing ? 'chevron-down' : 'chevron-right'} class="size-3" />
					{m.ideate_edit_visual()}
				</Button>
			{/if}
		{/if}
		<Button
			size="xs"
			class="ms-auto px-1"
			onclick={() => onUse(option)}
			disabled={busy || rendering || !!error}>{m.ideate_use_post()}</Button
		>
	</div>
	{#if plan?.media.document}
		<div id={visualEditorId} hidden={!visualEditing}>
			<fieldset class="grid gap-3" disabled={busy}>
				{#if plan.media.document.meme}<MemeFields
						{workspaceId}
						value={plan.media.document.meme}
						onchange={(meme) => changeVisual({ meme })}
					/>{:else if plan.media.document.conversation}<ConversationFields
						{workspaceId}
						value={plan.media.document.conversation}
						onchange={(conversation) => changeVisual({ conversation })}
					/>{:else if plan.media.document.receipt}<ReceiptFields
						value={plan.media.document.receipt}
						onchange={(receipt) => changeVisual({ receipt })}
					/>{:else if plan.media.document.status_page}<StatusFields
						value={plan.media.document.status_page}
						onchange={(status_page) => changeVisual({ status_page })}
					/>{/if}
			</fieldset>
		</div>
	{/if}
</article>
