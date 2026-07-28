<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		Bookmark,
		Heart,
		ImagePlus,
		MessageCircle,
		MoreHorizontal,
		Repeat2,
		Send,
		Share2,
		ThumbsUp
	} from 'lucide-svelte';
	import PlatformIcon from '$lib/components/platform-icon.svelte';

	type PreviewPlatform = 'x' | 'mastodon' | 'bluesky' | 'linkedin' | 'threads' | 'instagram';

	const platformOptions: Array<{ key: PreviewPlatform; name: string }> = [
		{ key: 'x', name: 'X' },
		{ key: 'mastodon', name: 'Mastodon' },
		{ key: 'bluesky', name: 'Bluesky' },
		{ key: 'linkedin', name: 'LinkedIn' },
		{ key: 'threads', name: 'Threads' },
		{ key: 'instagram', name: 'Instagram' }
	];

	let selectedPlatform = $state<PreviewPlatform>('x');
	let author = $state('OpenPost');
	let handle = $state('openpost');
	let draft = $state(
		'One draft can become several better posts. Check the destination, adjust the details, then schedule with confidence.'
	);
	let imageUrl = $state('');
	let localImageUrl = $state('');
	let localImageName = $state('');
	let altText = $state('');
	let imageFailed = $state(false);

	const cleanHandle = $derived(handle.trim().replace(/^@/u, '') || 'handle');
	const displayAuthor = $derived(author.trim() || 'Your name');
	const initial = $derived(displayAuthor.slice(0, 1).toUpperCase());
	const imageSource = $derived(localImageUrl || imageUrl.trim());

	function chooseLocalImage(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		if (localImageUrl) URL.revokeObjectURL(localImageUrl);
		localImageUrl = URL.createObjectURL(file);
		localImageName = file.name;
		imageFailed = false;
	}

	function clearLocalImage() {
		if (localImageUrl) URL.revokeObjectURL(localImageUrl);
		localImageUrl = '';
		localImageName = '';
		const input = document.querySelector<HTMLInputElement>('#preview-local-image');
		if (input) input.value = '';
		imageFailed = false;
	}

	onDestroy(() => {
		if (localImageUrl) URL.revokeObjectURL(localImageUrl);
	});
</script>

{#snippet avatar(size: string, color: string)}
	<div class={`grid ${size} shrink-0 place-items-center rounded-full ${color} text-sm font-bold`} aria-hidden="true">
		{initial}
	</div>
{/snippet}

{#snippet media(classes: string)}
	{#if imageSource && !imageFailed}
		<img
			src={imageSource}
			alt={altText}
			class={classes}
			referrerpolicy="no-referrer"
			onerror={() => (imageFailed = true)}
		/>
	{:else}
		<div class={`${classes} grid place-items-center bg-muted/50 text-muted-foreground`}>
			<div class="text-center">
				<ImagePlus class="mx-auto size-7" />
				<p class="mt-2 text-xs">{imageFailed ? 'Image could not be loaded' : 'Add an image to test the crop'}</p>
			</div>
		</div>
	{/if}
{/snippet}

<div class="mt-8 grid gap-5 xl:grid-cols-[23rem_minmax(0,1fr)]">
	<section class="rounded-lg border bg-card p-4 sm:p-6" aria-labelledby="preview-controls-title">
		<h2 id="preview-controls-title" class="text-lg font-semibold">Preview details</h2>
		<p class="mt-1 text-sm leading-6 text-muted-foreground">
			Use a local image or a public image URL. Local files never leave this browser.
		</p>

		<div class="mt-5 grid gap-4">
			<label class="grid gap-2 text-sm font-medium" for="preview-platform">
				Platform
				<select
					id="preview-platform"
					bind:value={selectedPlatform}
					class="min-h-11 rounded-md border bg-background px-3 py-2"
				>
					{#each platformOptions as platform (platform.key)}
						<option value={platform.key}>{platform.name}</option>
					{/each}
				</select>
			</label>

			<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
				<label class="grid gap-2 text-sm font-medium" for="preview-author">
					Display name
					<input
						id="preview-author"
						bind:value={author}
						class="min-h-11 rounded-md border bg-background px-3 py-2"
						maxlength="80"
					/>
				</label>
				<label class="grid gap-2 text-sm font-medium" for="preview-handle">
					Handle
					<input
						id="preview-handle"
						bind:value={handle}
						class="min-h-11 rounded-md border bg-background px-3 py-2"
						maxlength="100"
					/>
				</label>
			</div>

			<label class="grid gap-2 text-sm font-medium" for="preview-copy">
				Post copy
				<textarea
					id="preview-copy"
					bind:value={draft}
					class="min-h-40 resize-y rounded-md border bg-background p-3 leading-6"
					placeholder="Write the post you want to preview..."
				></textarea>
			</label>

			<label class="grid gap-2 text-sm font-medium" for="preview-image-url">
				Public image URL
				<input
					id="preview-image-url"
					type="url"
					bind:value={imageUrl}
					oninput={() => (imageFailed = false)}
					class="min-h-11 rounded-md border bg-background px-3 py-2"
					placeholder="https://example.com/image.jpg"
				/>
			</label>

			<div>
				<label for="preview-local-image" class="text-sm font-medium">Or choose a local image</label>
				<input
					id="preview-local-image"
					type="file"
					accept="image/*"
					onchange={chooseLocalImage}
					class="mt-2 block min-h-11 w-full rounded-md border bg-background text-sm file:mr-3 file:min-h-11 file:border-0 file:border-r file:bg-muted file:px-3 file:text-sm file:font-medium"
				/>
				{#if localImageName}
					<div class="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
						<span class="truncate">Using {localImageName}</span>
						<button type="button" class="min-h-11 font-medium text-primary md:min-h-0" onclick={clearLocalImage}>
							Remove
						</button>
					</div>
				{/if}
			</div>

			<label class="grid gap-2 text-sm font-medium" for="preview-alt-text">
				Image alt text
				<textarea
					id="preview-alt-text"
					bind:value={altText}
					class="min-h-24 resize-y rounded-md border bg-background p-3 leading-6"
					placeholder="Describe the useful content of the image..."
				></textarea>
			</label>
		</div>
	</section>

	<section class="rounded-lg border bg-muted/15 p-4 sm:p-6" aria-labelledby="destination-preview-title">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div>
				<h2 id="destination-preview-title" class="text-lg font-semibold">Destination preview</h2>
				<p class="mt-1 text-sm text-muted-foreground">Layouts approximate each network and may change.</p>
			</div>
			{#if imageSource}
				<span class={`rounded-full border px-3 py-1 text-xs ${altText.trim() ? 'text-primary' : 'text-amber-400'}`}>
					{altText.trim() ? 'Alt text included' : 'Alt text still needed'}
				</span>
			{/if}
		</div>

		<div class="mt-6 flex min-h-[32rem] items-center justify-center overflow-hidden rounded-xl border bg-background/55 p-3 sm:p-6">
			{#if selectedPlatform === 'x'}
				<article class="w-full max-w-xl rounded-2xl border bg-background p-4 shadow-sm" aria-label="X post preview">
					<div class="flex gap-3">
						{@render avatar('size-11', 'bg-zinc-800 text-white')}
						<div class="min-w-0 flex-1">
							<div class="flex min-w-0 items-center gap-1 text-sm">
								<strong class="truncate">{displayAuthor}</strong>
								<span class="truncate text-muted-foreground">@{cleanHandle}</span>
								<span class="text-muted-foreground">· now</span>
							</div>
							<p class="mt-1 whitespace-pre-wrap text-[15px] leading-6 break-words">{draft}</p>
							{#if imageSource}
								<div class="mt-3 overflow-hidden rounded-2xl border">
									{@render media('aspect-video w-full object-cover')}
								</div>
							{/if}
							<div class="mt-4 flex justify-between text-muted-foreground" aria-hidden="true">
								<MessageCircle class="size-4" /><Repeat2 class="size-4" /><Heart class="size-4" /><Share2 class="size-4" />
							</div>
						</div>
					</div>
				</article>
			{:else if selectedPlatform === 'mastodon'}
				<article class="w-full max-w-xl rounded-xl border border-violet-500/30 bg-background p-5" aria-label="Mastodon post preview">
					<div class="flex gap-3">
						{@render avatar('size-12', 'bg-violet-500/20 text-violet-300')}
						<div class="min-w-0 flex-1">
							<div><strong>{displayAuthor}</strong> <span class="text-sm text-muted-foreground">@{cleanHandle}</span></div>
							<p class="mt-3 whitespace-pre-wrap text-[15px] leading-6 break-words">{draft}</p>
							{#if imageSource}
								<div class="mt-3 overflow-hidden rounded-lg">{@render media('max-h-96 w-full object-cover')}</div>
							{/if}
							<div class="mt-4 grid grid-cols-2 gap-3 text-xs text-muted-foreground sm:grid-cols-4" aria-hidden="true">
								<span>Reply</span><span>Boost</span><span>Favorite</span><span>Share</span>
							</div>
						</div>
					</div>
				</article>
			{:else if selectedPlatform === 'bluesky'}
				<article class="w-full max-w-xl border-y bg-background py-4" aria-label="Bluesky post preview">
					<div class="flex gap-3 px-4">
						{@render avatar('size-10', 'bg-sky-500/20 text-sky-300')}
						<div class="min-w-0 flex-1">
							<div class="flex items-center justify-between gap-2">
								<p class="min-w-0 truncate text-sm"><strong>{displayAuthor}</strong> <span class="text-muted-foreground">@{cleanHandle} · 1m</span></p>
								<MoreHorizontal class="size-4 shrink-0 text-muted-foreground" />
							</div>
							<p class="mt-1 whitespace-pre-wrap text-[15px] leading-6 break-words">{draft}</p>
							{#if imageSource}
								<div class="mt-3 overflow-hidden rounded-xl border">{@render media('aspect-[4/3] w-full object-cover')}</div>
							{/if}
							<div class="mt-4 flex max-w-sm justify-between text-sky-400" aria-hidden="true">
								<MessageCircle class="size-4" /><Repeat2 class="size-4" /><Heart class="size-4" /><Share2 class="size-4" />
							</div>
						</div>
					</div>
				</article>
			{:else if selectedPlatform === 'linkedin'}
				<article class="w-full max-w-xl rounded-lg border bg-background shadow-sm" aria-label="LinkedIn post preview">
					<div class="flex items-start gap-3 p-4">
						{@render avatar('size-12', 'bg-blue-600 text-white')}
						<div class="min-w-0 flex-1">
							<strong>{displayAuthor}</strong>
							<p class="text-xs text-muted-foreground">@{cleanHandle} · 1m · Public</p>
						</div>
						<MoreHorizontal class="size-5 text-muted-foreground" />
					</div>
					<p class="px-4 pb-4 whitespace-pre-wrap text-sm leading-6 break-words">{draft}</p>
					{#if imageSource}{@render media('aspect-[1.91/1] w-full border-y object-cover')}{/if}
					<div class="grid grid-cols-4 border-t p-2 text-xs text-muted-foreground" aria-hidden="true">
						<span class="flex items-center justify-center gap-1"><ThumbsUp class="size-4" /> Like</span>
						<span class="flex items-center justify-center gap-1"><MessageCircle class="size-4" /> Comment</span>
						<span class="flex items-center justify-center gap-1"><Repeat2 class="size-4" /> Repost</span>
						<span class="flex items-center justify-center gap-1"><Send class="size-4" /> Send</span>
					</div>
				</article>
			{:else if selectedPlatform === 'threads'}
				<article class="w-full max-w-lg border-b bg-background p-4" aria-label="Threads post preview">
					<div class="flex gap-3">
						<div class="flex flex-col items-center">
							{@render avatar('size-10', 'bg-orange-500/20 text-orange-300')}
							<div class="mt-2 h-full w-px bg-border"></div>
						</div>
						<div class="min-w-0 flex-1">
							<div class="flex items-center justify-between"><strong class="text-sm">{cleanHandle}</strong><span class="text-xs text-muted-foreground">1m ···</span></div>
							<p class="mt-1 whitespace-pre-wrap text-[15px] leading-6 break-words">{draft}</p>
							{#if imageSource}<div class="mt-3 overflow-hidden rounded-xl border">{@render media('aspect-square w-full object-cover')}</div>{/if}
							<div class="mt-4 flex gap-5 text-muted-foreground" aria-hidden="true"><Heart class="size-5" /><MessageCircle class="size-5" /><Repeat2 class="size-5" /><Send class="size-5" /></div>
						</div>
					</div>
				</article>
			{:else}
				<article class="w-full max-w-sm overflow-hidden rounded-xl border bg-background shadow-sm" aria-label="Instagram post preview">
					<div class="flex items-center gap-3 p-3">
						{@render avatar('size-9', 'bg-pink-500/20 text-pink-300')}
						<strong class="min-w-0 flex-1 truncate text-sm">{cleanHandle}</strong>
						<MoreHorizontal class="size-5 text-muted-foreground" />
					</div>
					{@render media('aspect-square w-full object-cover')}
					<div class="p-3">
						<div class="flex items-center justify-between" aria-hidden="true"><div class="flex gap-4"><Heart class="size-5" /><MessageCircle class="size-5" /><Send class="size-5" /></div><Bookmark class="size-5" /></div>
						<p class="mt-3 text-sm leading-6 break-words"><strong>{cleanHandle}</strong> {draft}</p>
					</div>
				</article>
			{/if}
		</div>
	</section>
</div>
