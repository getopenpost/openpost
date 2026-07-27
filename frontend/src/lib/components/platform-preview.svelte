<script lang="ts">
	import { getAuthenticatedMediaByID } from '$lib/media-url';
	import { getPlatformKey, getPlatformName } from '$lib/utils';
	import PlatformIcon from './platform-icon.svelte';
	import HeartIcon from 'lucide-svelte/icons/heart';
	import MessageCircleIcon from 'lucide-svelte/icons/message-circle';
	import RepeatIcon from 'lucide-svelte/icons/repeat-2';
	import ShareIcon from 'lucide-svelte/icons/share';
	import MoreHorizontalIcon from 'lucide-svelte/icons/more-horizontal';
	import BookmarkIcon from 'lucide-svelte/icons/bookmark';
	import PlayIcon from 'lucide-svelte/icons/play';
	import ThumbsUpIcon from 'lucide-svelte/icons/thumbs-up';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		platform: string;
		content: string;
		mediaIds: string[];
		mediaMimeTypes?: Record<string, string>;
		username?: string;
		displayName?: string;
		avatarUrl?: string;
		variantContent?: string | null;
		isUnsynced?: boolean;
	}

	let {
		platform,
		content,
		mediaIds,
		mediaMimeTypes = {},
		username = m.platform_preview_username(),
		displayName = m.platform_preview_display_name(),
		avatarUrl,
		variantContent = null,
		isUnsynced = false
	}: Props = $props();

	const platformKey = $derived(getPlatformKey(platform));
	const previewContent = $derived(variantContent ?? content);
	const previewName = $derived(getPlatformName(platform));

	function formatContent(text: string): string {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/\n/g, '<br>')
			.replace(/(#[a-zA-Z0-9_]+)/g, '<span class="text-blue-500">$1</span>')
			.replace(/(@[a-zA-Z0-9_]+)/g, '<span class="text-blue-500">$1</span>')
			.replace(/(https?:\/\/[^\s]+)/g, '<span class="text-blue-500">$1</span>');
	}

	const mediaLayout = $derived.by(() => {
		if (mediaIds.length === 0) return 'none';
		if (mediaIds.length === 1) return 'single';
		if (mediaIds.length === 2) return 'grid-2';
		if (mediaIds.length === 3) return 'grid-3';
		return 'grid-4';
	});

	function isVideo(id: string): boolean {
		return mediaMimeTypes[id]?.startsWith('video/') ?? false;
	}

	function firstLine(text: string, fallback: string): string {
		return (
			text
				.split(/\r?\n/)
				.map((line) => line.trim())
				.find(Boolean) ?? fallback
		);
	}

	function remainingLines(text: string): string {
		return text
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean)
			.slice(1)
			.join('\n');
	}
</script>

{#snippet mediaElement(id: string, classes: string)}
	{#if isVideo(id)}
		<video src={getAuthenticatedMediaByID(id)} class={classes} controls muted playsinline></video>
	{:else}
		<img src={getAuthenticatedMediaByID(id)} alt="" class={classes} />
	{/if}
{/snippet}

{#if platformKey === 'x'}
	<!-- X/Twitter Preview -->
	<div class="w-full max-w-xl rounded-xl border border-border/60 bg-background p-4 shadow-sm">
		<div class="flex gap-3">
			<div class="shrink-0">
				{#if avatarUrl}
					<img src={avatarUrl} alt="" class="h-10 w-10 rounded-full object-cover" />
				{:else}
					<div class="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
						<span class="text-sm font-medium">{displayName.charAt(0)}</span>
					</div>
				{/if}
			</div>
			<div class="min-w-0 flex-1">
				<div class="flex items-center gap-1">
					<span class="truncate font-semibold text-foreground">{displayName}</span>
					<span class="shrink-0 text-muted-foreground">@{username}</span>
					<span class="shrink-0 text-muted-foreground">·</span>
					<span class="shrink-0 text-muted-foreground">{m.platform_preview_now()}</span>
				</div>
				{#if isUnsynced}
					<div class="mt-0.5 text-xs text-amber-500">
						{m.platform_preview_customized_for({ platform: previewName })}
					</div>
				{/if}
				<div class="mt-1 text-[15px] leading-normal text-foreground">
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					{@html formatContent(previewContent)}
				</div>
				{#if mediaIds.length > 0}
					<div class="mt-3 overflow-hidden rounded-xl border border-border/60">
						{#if mediaLayout === 'single'}
							{@render mediaElement(mediaIds[0], 'h-auto w-full object-cover')}
						{:else if mediaLayout === 'grid-2'}
							<div class="grid grid-cols-2 gap-0.5">
								{#each mediaIds as id (id)}
									{@render mediaElement(id, 'aspect-square w-full object-cover')}
								{/each}
							</div>
						{:else if mediaLayout === 'grid-3'}
							<div class="grid grid-cols-2 gap-0.5">
								{@render mediaElement(mediaIds[0], 'col-span-2 aspect-video w-full object-cover')}
								{@render mediaElement(mediaIds[1], 'aspect-square w-full object-cover')}
								{@render mediaElement(mediaIds[2], 'aspect-square w-full object-cover')}
							</div>
						{:else}
							<div class="grid grid-cols-2 gap-0.5">
								{#each mediaIds as id (id)}
									{@render mediaElement(id, 'aspect-square w-full object-cover')}
								{/each}
							</div>
						{/if}
					</div>
				{/if}
				<div class="mt-3 flex items-center justify-between text-muted-foreground">
					<div class="flex items-center gap-1 hover:text-blue-500">
						<MessageCircleIcon class="h-4 w-4" />
					</div>
					<div class="flex items-center gap-1 hover:text-green-500">
						<RepeatIcon class="h-4 w-4" />
					</div>
					<div class="flex items-center gap-1 hover:text-red-500">
						<HeartIcon class="h-4 w-4" />
					</div>
					<div class="flex items-center gap-1 hover:text-blue-500">
						<ShareIcon class="h-4 w-4" />
					</div>
				</div>
			</div>
		</div>
	</div>
{:else if platformKey === 'mastodon'}
	<!-- Mastodon Preview -->
	<div class="w-full max-w-xl rounded-lg border border-border/60 bg-background p-4">
		<div class="flex gap-3">
			<div class="shrink-0">
				{#if avatarUrl}
					<img src={avatarUrl} alt="" class="h-12 w-12 rounded-full object-cover" />
				{:else}
					<div
						class="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900"
					>
						<span class="text-lg font-semibold text-indigo-600 dark:text-indigo-300"
							>{displayName.charAt(0)}</span
						>
					</div>
				{/if}
			</div>
			<div class="min-w-0 flex-1">
				<div class="flex items-center gap-1.5">
					<span class="font-semibold text-foreground">{displayName}</span>
					<span class="text-sm text-muted-foreground">@{username}</span>
				</div>
				{#if isUnsynced}
					<div class="text-xs text-amber-500">
						{m.platform_preview_customized_for({ platform: previewName })}
					</div>
				{/if}
				<div class="mt-2 text-[15px] leading-relaxed whitespace-pre-wrap text-foreground">
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					{@html formatContent(previewContent)}
				</div>
				{#if mediaIds.length > 0}
					<div class="mt-3 grid grid-cols-2 gap-2">
						{#each mediaIds as id (id)}
							{@render mediaElement(id, 'max-h-[260px] rounded-lg object-cover')}
						{/each}
					</div>
				{/if}
				<div
					class="mt-3 grid grid-cols-2 gap-x-2 gap-y-2 text-xs text-muted-foreground sm:flex sm:flex-wrap sm:gap-5 sm:text-sm"
				>
					<span class="flex items-center gap-1.5 hover:text-indigo-500">
						<MessageCircleIcon class="size-4 shrink-0" />
						{m.platform_preview_reply()}
					</span>
					<span class="flex items-center gap-1.5 hover:text-green-500">
						<RepeatIcon class="size-4 shrink-0" />
						{m.platform_preview_boost()}
					</span>
					<span class="flex items-center gap-1.5 hover:text-red-500">
						<HeartIcon class="size-4 shrink-0" />
						{m.platform_preview_favorite()}
					</span>
					<span class="flex items-center gap-1.5 hover:text-foreground">
						<ShareIcon class="size-4 shrink-0" />
						{m.platform_preview_share()}
					</span>
				</div>
			</div>
		</div>
	</div>
{:else if platformKey === 'bluesky'}
	<!-- Bluesky Preview -->
	<div class="w-full max-w-xl border-b border-border/40 bg-background px-4 py-4">
		<div class="flex gap-3">
			<div class="shrink-0">
				{#if avatarUrl}
					<img src={avatarUrl} alt="" class="h-10 w-10 rounded-full object-cover" />
				{:else}
					<div
						class="flex h-10 w-10 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-900"
					>
						<span class="text-sm font-bold text-sky-600 dark:text-sky-300"
							>{displayName.charAt(0)}</span
						>
					</div>
				{/if}
			</div>
			<div class="min-w-0 flex-1">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-1.5">
						<span class="font-semibold text-foreground">{displayName}</span>
						<span class="text-sm text-muted-foreground">@{username}</span>
						<span class="text-sm text-muted-foreground">· {m.platform_preview_now()}</span>
					</div>
					<MoreHorizontalIcon class="h-4 w-4 text-muted-foreground" />
				</div>
				{#if isUnsynced}
					<div class="text-xs text-amber-500">
						{m.platform_preview_customized_for({ platform: previewName })}
					</div>
				{/if}
				<div class="mt-1 text-[15px] leading-normal text-foreground">
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					{@html formatContent(previewContent)}
				</div>
				{#if mediaIds.length > 0}
					<div class="mt-3 overflow-hidden rounded-lg border border-border/40">
						{#if mediaLayout === 'single'}
							{@render mediaElement(mediaIds[0], 'h-auto w-full object-cover')}
						{:else}
							<div class="grid grid-cols-2 gap-0.5">
								{#each mediaIds as id (id)}
									{@render mediaElement(id, 'aspect-square w-full object-cover')}
								{/each}
							</div>
						{/if}
					</div>
				{/if}
				<div class="mt-3 flex items-center justify-between text-muted-foreground">
					<div class="flex items-center gap-1 hover:text-sky-500">
						<MessageCircleIcon class="h-4 w-4" />
						<span class="text-sm">0</span>
					</div>
					<div class="flex items-center gap-1 hover:text-green-500">
						<RepeatIcon class="h-4 w-4" />
						<span class="text-sm">0</span>
					</div>
					<div class="flex items-center gap-1 hover:text-red-500">
						<HeartIcon class="h-4 w-4" />
						<span class="text-sm">0</span>
					</div>
					<div class="flex items-center gap-1 hover:text-sky-500">
						<ShareIcon class="h-4 w-4" />
					</div>
				</div>
			</div>
		</div>
	</div>
{:else if platformKey === 'linkedin'}
	<!-- LinkedIn Preview -->
	<div class="w-full max-w-xl rounded-lg border border-border/60 bg-background p-4">
		<div class="flex items-center gap-3">
			{#if avatarUrl}
				<img src={avatarUrl} alt="" class="h-12 w-12 rounded-full object-cover" />
			{:else}
				<div
					class="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900"
				>
					<span class="text-lg font-semibold text-blue-700 dark:text-blue-300"
						>{displayName.charAt(0)}</span
					>
				</div>
			{/if}
			<div class="min-w-0 flex-1">
				<div class="font-semibold text-foreground">{displayName}</div>
				<div class="text-sm text-muted-foreground">
					@{username} · {m.platform_preview_now()}
				</div>
			</div>
			<MoreHorizontalIcon class="h-5 w-5 text-muted-foreground" />
		</div>
		{#if isUnsynced}
			<div class="mt-1 text-xs text-amber-500">
				{m.platform_preview_customized_for({ platform: previewName })}
			</div>
		{/if}
		<div class="mt-3 text-sm leading-relaxed text-foreground">
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			{@html formatContent(previewContent)}
		</div>
		{#if mediaIds.length > 0}
			<div class="mt-3 overflow-hidden rounded-lg border border-border/40">
				{@render mediaElement(mediaIds[0], 'h-auto w-full object-cover')}
			</div>
			{#if mediaIds.length > 1}
				<div class="mt-2 text-xs text-muted-foreground">
					{m.platform_preview_first_attachment({ platform: 'LinkedIn' })}
				</div>
			{/if}
		{/if}
		<div
			class="mt-3 grid grid-cols-2 gap-x-2 gap-y-2 border-t pt-3 text-xs text-muted-foreground sm:flex sm:flex-wrap sm:gap-4 sm:text-sm"
		>
			<span class="flex items-center gap-1.5 hover:text-blue-600">
				<HeartIcon class="size-4 shrink-0" />
				{m.platform_preview_like()}
			</span>
			<span class="flex items-center gap-1.5 hover:text-blue-600">
				<MessageCircleIcon class="size-4 shrink-0" />
				{m.platform_preview_comment()}
			</span>
			<span class="flex items-center gap-1.5 hover:text-blue-600">
				<RepeatIcon class="size-4 shrink-0" />
				{m.platform_preview_repost()}
			</span>
			<span class="flex items-center gap-1.5 hover:text-blue-600">
				<ShareIcon class="size-4 shrink-0" />
				{m.platform_preview_send()}
			</span>
		</div>
	</div>
{:else if platformKey === 'threads'}
	<!-- Threads Preview -->
	<div class="w-full max-w-xl border-b border-border/40 bg-background px-4 py-4">
		<div class="flex gap-3">
			<div class="shrink-0">
				{#if avatarUrl}
					<img src={avatarUrl} alt="" class="h-9 w-9 rounded-full object-cover" />
				{:else}
					<div
						class="flex h-9 w-9 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-900"
					>
						<span class="text-sm font-bold text-orange-600 dark:text-orange-300"
							>{displayName.charAt(0)}</span
						>
					</div>
				{/if}
			</div>
			<div class="min-w-0 flex-1">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<span class="font-semibold text-foreground">{displayName}</span>
						<span class="text-sm text-muted-foreground">@{username}</span>
						<span class="text-sm text-muted-foreground">· {m.platform_preview_now()}</span>
					</div>
					<MoreHorizontalIcon class="h-4 w-4 text-muted-foreground" />
				</div>
				{#if isUnsynced}
					<div class="text-xs text-amber-500">
						{m.platform_preview_customized_for({ platform: previewName })}
					</div>
				{/if}
				<div class="mt-1 text-[15px] leading-normal text-foreground">
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					{@html formatContent(previewContent)}
				</div>
				{#if mediaIds.length > 0}
					<div class="mt-3 overflow-hidden rounded-lg border border-border/40">
						{@render mediaElement(mediaIds[0], 'h-auto w-full object-cover')}
					</div>
					{#if mediaIds.length > 1}
						<div class="mt-2 text-xs text-muted-foreground">
							{m.platform_preview_first_attachment({ platform: 'Threads' })}
						</div>
					{/if}
				{/if}
				<div class="mt-3 flex items-center gap-6 text-muted-foreground">
					<div class="flex items-center gap-1.5 hover:text-foreground">
						<MessageCircleIcon class="h-4 w-4" />
						<span class="text-sm">0</span>
					</div>
					<div class="flex items-center gap-1.5 hover:text-foreground">
						<RepeatIcon class="h-4 w-4" />
						<span class="text-sm">0</span>
					</div>
					<div class="flex items-center gap-1.5 hover:text-red-500">
						<HeartIcon class="h-4 w-4" />
						<span class="text-sm">0</span>
					</div>
					<div class="flex items-center gap-1.5 hover:text-foreground">
						<ShareIcon class="h-4 w-4" />
					</div>
				</div>
			</div>
		</div>
	</div>
{:else if platformKey === 'instagram'}
	<!-- Instagram Preview -->
	<div
		class="w-full max-w-sm overflow-hidden rounded-xl border border-border/60 bg-background shadow-sm"
		data-testid="instagram-preview"
	>
		<div class="flex items-center gap-3 border-b border-border/60 px-3 py-2.5">
			{#if avatarUrl}
				<img src={avatarUrl} alt="" class="h-8 w-8 rounded-full object-cover" />
			{:else}
				<div
					class="flex h-8 w-8 items-center justify-center rounded-full bg-pink-100 dark:bg-pink-950"
				>
					<span class="text-xs font-bold text-pink-700 dark:text-pink-300"
						>{displayName.charAt(0)}</span
					>
				</div>
			{/if}
			<div class="min-w-0 flex-1">
				<div class="truncate text-sm font-semibold">@{username}</div>
				<div class="text-xs text-muted-foreground">{m.platform_preview_instagram_post()}</div>
			</div>
			<MoreHorizontalIcon class="h-5 w-5 text-muted-foreground" />
		</div>

		{#if mediaIds.length > 0}
			{@render mediaElement(mediaIds[0], 'aspect-square w-full object-cover')}
		{:else}
			<div
				class="flex aspect-square w-full items-center justify-center bg-gradient-to-br from-fuchsia-500/20 via-orange-500/15 to-yellow-400/20"
			>
				<PlatformIcon platform="instagram" class="h-10 w-10 text-pink-500" />
			</div>
		{/if}

		<div class="space-y-3 px-3 py-3">
			<div class="flex items-center justify-between text-foreground">
				<div class="flex items-center gap-4">
					<HeartIcon class="h-5 w-5" />
					<MessageCircleIcon class="h-5 w-5" />
					<ShareIcon class="h-5 w-5" />
				</div>
				<BookmarkIcon class="h-5 w-5" />
			</div>
			{#if isUnsynced}
				<div class="text-xs text-amber-500">
					{m.platform_preview_customized_for({ platform: previewName })}
				</div>
			{/if}
			<div class="text-sm leading-normal text-foreground">
				<span class="font-semibold">@{username}</span>
				<span>
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					{@html formatContent(previewContent)}
				</span>
			</div>
		</div>
	</div>
{:else if platformKey === 'facebook'}
	<!-- Facebook Preview -->
	<div
		class="w-full max-w-xl rounded-lg border border-border/60 bg-background p-4 shadow-sm"
		data-testid="facebook-preview"
	>
		<div class="flex items-start gap-3">
			{#if avatarUrl}
				<img src={avatarUrl} alt="" class="h-10 w-10 rounded-full object-cover" />
			{:else}
				<div
					class="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-950"
				>
					<span class="text-sm font-bold text-blue-700 dark:text-blue-300"
						>{displayName.charAt(0)}</span
					>
				</div>
			{/if}
			<div class="min-w-0 flex-1">
				<div class="font-semibold text-foreground">{displayName}</div>
				<div class="text-xs text-muted-foreground">
					@{username} · {m.platform_preview_scheduled()}
				</div>
			</div>
			<MoreHorizontalIcon class="h-5 w-5 text-muted-foreground" />
		</div>
		{#if isUnsynced}
			<div class="mt-2 text-xs text-amber-500">
				{m.platform_preview_customized_for({ platform: previewName })}
			</div>
		{/if}
		<div class="mt-3 text-[15px] leading-relaxed text-foreground">
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			{@html formatContent(previewContent)}
		</div>
		{#if mediaIds.length > 0}
			<div class="mt-3 overflow-hidden rounded-md border border-border/50">
				{#if mediaLayout === 'single'}
					{@render mediaElement(mediaIds[0], 'h-auto w-full object-cover')}
				{:else}
					<div class="grid grid-cols-2 gap-0.5">
						{#each mediaIds.slice(0, 4) as id (id)}
							{@render mediaElement(id, 'aspect-square w-full object-cover')}
						{/each}
					</div>
				{/if}
			</div>
		{/if}
		<div
			class="mt-4 grid grid-cols-3 border-t border-border/60 pt-3 text-center text-sm font-medium text-muted-foreground"
		>
			<span class="flex items-center justify-center gap-1.5 hover:text-blue-600">
				<ThumbsUpIcon class="h-4 w-4" />
				{m.platform_preview_like()}
			</span>
			<span class="flex items-center justify-center gap-1.5 hover:text-blue-600">
				<MessageCircleIcon class="h-4 w-4" />
				{m.platform_preview_comment()}
			</span>
			<span class="flex items-center justify-center gap-1.5 hover:text-blue-600">
				<ShareIcon class="h-4 w-4" />
				{m.platform_preview_share()}
			</span>
		</div>
	</div>
{:else if platformKey === 'youtube'}
	<!-- YouTube Preview -->
	<div
		class="w-full max-w-xl overflow-hidden rounded-xl border border-border/60 bg-background shadow-sm"
		data-testid="youtube-preview"
	>
		<div class="relative aspect-video bg-muted">
			{#if mediaIds.length > 0}
				{@render mediaElement(mediaIds[0], 'h-full w-full object-cover')}
			{:else}
				<div
					class="flex h-full w-full items-center justify-center bg-gradient-to-br from-red-500/20 to-zinc-900/30"
				>
					<PlatformIcon platform="youtube" class="h-12 w-12 text-red-600" />
				</div>
			{/if}
			<div class="absolute inset-0 flex items-center justify-center">
				<div class="flex h-12 w-12 items-center justify-center rounded-full bg-black/70 text-white">
					<PlayIcon class="ml-0.5 h-6 w-6 fill-current" />
				</div>
			</div>
		</div>
		<div class="flex gap-3 p-4">
			{#if avatarUrl}
				<img src={avatarUrl} alt="" class="h-10 w-10 rounded-full object-cover" />
			{:else}
				<div
					class="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-950"
				>
					<span class="text-sm font-bold text-red-700 dark:text-red-300"
						>{displayName.charAt(0)}</span
					>
				</div>
			{/if}
			<div class="min-w-0 flex-1">
				<h3 class="line-clamp-2 text-sm font-semibold text-foreground">
					{firstLine(previewContent, m.platform_preview_untitled_youtube_upload())}
				</h3>
				<div class="mt-1 text-xs text-muted-foreground">
					{displayName} · {m.platform_preview_scheduled_video()}
				</div>
				{#if remainingLines(previewContent)}
					<div class="mt-2 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
						<!-- eslint-disable-next-line svelte/no-at-html-tags -->
						{@html formatContent(remainingLines(previewContent))}
					</div>
				{/if}
				{#if isUnsynced}
					<div class="mt-2 text-xs text-amber-500">
						{m.platform_preview_customized_for({ platform: previewName })}
					</div>
				{/if}
			</div>
			<MoreHorizontalIcon class="h-5 w-5 text-muted-foreground" />
		</div>
	</div>
{:else if platformKey === 'tiktok'}
	<!-- TikTok Preview -->
	<div
		class="relative aspect-[9/16] w-full max-w-[280px] overflow-hidden rounded-2xl bg-zinc-950 text-white shadow-sm"
		data-testid="tiktok-preview"
	>
		{#if mediaIds.length > 0}
			{@render mediaElement(mediaIds[0], 'absolute inset-0 h-full w-full object-cover')}
		{:else}
			<div
				class="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-cyan-500/30 via-zinc-950 to-pink-500/30"
			>
				<PlatformIcon platform="tiktok" class="h-12 w-12 text-white" />
			</div>
		{/if}
		<div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-black/35"></div>
		<div class="absolute right-3 bottom-20 flex flex-col items-center gap-4">
			<div
				class="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 backdrop-blur"
			>
				<HeartIcon class="h-5 w-5" />
			</div>
			<div
				class="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 backdrop-blur"
			>
				<MessageCircleIcon class="h-5 w-5" />
			</div>
			<div
				class="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 backdrop-blur"
			>
				<ShareIcon class="h-5 w-5" />
			</div>
		</div>
		<div class="absolute right-3 bottom-4">
			<div
				class="flex h-10 w-10 items-center justify-center rounded-full border border-white/30 bg-zinc-900"
			>
				<PlatformIcon platform="tiktok" class="h-5 w-5" />
			</div>
		</div>
		<div class="absolute right-16 bottom-4 left-4 space-y-2">
			<div class="text-sm font-semibold">@{username}</div>
			{#if isUnsynced}
				<div class="text-xs text-amber-200">
					{m.platform_preview_customized_for({ platform: previewName })}
				</div>
			{/if}
			<div class="line-clamp-4 text-sm leading-normal">
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				{@html formatContent(previewContent)}
			</div>
		</div>
	</div>
{:else}
	<!-- Generic Preview -->
	<div class="w-full max-w-xl rounded-lg border border-border/60 bg-background p-4">
		<div class="flex items-center gap-2">
			<PlatformIcon platform={platformKey} class="h-5 w-5" />
			<span class="font-medium">{previewName}</span>
		</div>
		{#if isUnsynced}
			<div class="mt-1 text-xs text-amber-500">
				{m.platform_preview_customized_for({ platform: previewName })}
			</div>
		{/if}
		<div class="mt-2 text-sm text-foreground">
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			{@html formatContent(previewContent)}
		</div>
		{#if mediaIds.length > 0}
			<div class="mt-3 grid grid-cols-2 gap-2">
				{#each mediaIds as id (id)}
					{@render mediaElement(id, 'rounded-lg object-cover')}
				{/each}
			</div>
		{/if}
	</div>
{/if}
