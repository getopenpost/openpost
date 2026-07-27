<script lang="ts">
	import { FileText, Image, MessageCircle, Play, Rows3, Video } from 'lucide-svelte';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import type { MarketingPlatform } from '../../_marketing';

	interface Props {
		platform: MarketingPlatform;
	}

	let { platform }: Props = $props();
</script>

<div class="overflow-hidden rounded-xl border bg-card">
	<div class="flex items-center justify-between border-b bg-muted/20 px-4 py-3">
		<div class="flex items-center gap-2">
			<PlatformIcon platform={platform.short} class="size-4" />
			<span class="text-xs font-medium">{platform.preview.label}</span>
		</div>
		<span class="font-mono text-xs text-muted-foreground">{platform.preview.detail}</span>
	</div>

	<div class="p-5">
		{#if platform.slug === 'x'}
			<div class="space-y-0">
				{#each platform.preview.chips as chip, index (chip)}
					<div class="relative grid grid-cols-[1.75rem_1fr] gap-3 pb-4 last:pb-0">
						{#if index < platform.preview.chips.length - 1}<span class="absolute top-6 bottom-0 left-[0.85rem] w-px bg-border"></span>{/if}
						<span class="z-10 flex size-7 items-center justify-center rounded-full border bg-background font-mono text-[0.65rem]">{index + 1}</span>
						<div class="rounded-lg border bg-background/60 px-3 py-2">
							<p class="text-xs font-medium">{chip}</p>
							<div class="mt-2 h-1.5 rounded-full bg-muted {index === 1 ? 'w-4/5' : 'w-full'}"></div>
						</div>
					</div>
				{/each}
			</div>
		{:else if platform.slug === 'mastodon'}
			<div class="rounded-lg border bg-background/60 p-4">
				<div class="flex items-center justify-between gap-3 text-xs">
					<span class="font-medium">@openpost@mastodon.social</span><span class="rounded-full border px-2 py-1">Public</span>
				</div>
				<h3 class="mt-4 text-sm font-semibold">{platform.preview.headline}</h3>
				<p class="mt-2 text-xs leading-5 text-muted-foreground">{platform.preview.body}</p>
				<div class="mt-4 flex gap-4 text-muted-foreground"><MessageCircle class="size-4" /><Rows3 class="size-4" /></div>
			</div>
		{:else if platform.slug === 'bluesky'}
			<div>
				<p class="text-sm leading-6">A short launch note with <span class="text-primary underline underline-offset-2">linked context</span> and a clear destination.</p>
				<div class="mt-4 overflow-hidden rounded-lg border bg-background/60">
					<div class="h-20 border-b bg-primary/10"></div>
					<div class="p-3"><p class="text-xs font-medium">openpost.social</p><p class="mt-1 text-xs text-muted-foreground">Rich link metadata travels with the AT Protocol record.</p></div>
				</div>
			</div>
		{:else if platform.slug === 'linkedin'}
			<div class="grid gap-3 sm:grid-cols-[1fr_0.75fr]">
				<div class="flex min-h-36 flex-col justify-between rounded-lg border bg-background/60 p-4">
					<FileText class="size-6 text-primary" />
					<div><p class="text-sm font-semibold">{platform.preview.headline}</p><p class="mt-1 text-xs text-muted-foreground">Document title · PDF</p></div>
				</div>
				<div class="rounded-lg border bg-muted/20 p-4"><p class="text-[0.7rem] font-medium text-primary">Follow-up comment</p><p class="mt-3 text-xs leading-5 text-muted-foreground">A separate 1,250-character child keeps the post moving.</p></div>
			</div>
		{:else if platform.slug === 'threads'}
			<div class="grid grid-cols-4 gap-2">
				{#each [Image, Video, Image, Image] as Icon, index (index)}
					<div class="flex aspect-[3/4] items-center justify-center rounded-lg border bg-primary/10"><Icon class="size-5 text-muted-foreground" /></div>
				{/each}
			</div>
			<div class="mt-4 flex items-center justify-between"><p class="text-sm font-medium">{platform.preview.headline}</p><span class="text-xs text-muted-foreground">1 / 4</span></div>
		{:else if platform.slug === 'facebook'}
			<div class="grid gap-3 sm:grid-cols-[1fr_5rem]">
				<div class="rounded-lg border bg-background/60 p-4"><p class="text-xs font-medium">OpenPost Page</p><div class="mt-3 aspect-[16/7] rounded-md border bg-primary/10"></div><p class="mt-3 text-xs text-muted-foreground">Feed post with public media</p></div>
				<div class="rounded-lg border bg-primary/10 p-2 text-center"><div class="mx-auto mt-2 aspect-[9/16] rounded-md border bg-background/40"></div><p class="mt-2 text-[0.65rem]">Story</p></div>
			</div>
		{:else if platform.slug === 'instagram'}
			<div class="grid grid-cols-3 gap-2">
				{#each platform.preview.chips as chip, index (chip)}
					<div class="flex aspect-square flex-col items-center justify-center rounded-lg border bg-primary/10 p-2 text-center"><Image class="size-5 text-muted-foreground" /><span class="mt-2 text-xs font-medium">{chip}</span></div>
				{/each}
			</div>
			<p class="mt-4 text-center text-xs text-muted-foreground">Placement first; caption and media validation follow.</p>
		{:else if platform.slug === 'tiktok'}
			<div class="grid grid-cols-2 gap-3">
				<div class="relative aspect-[4/5] rounded-lg border bg-primary/10"><Play class="absolute top-1/2 left-1/2 size-7 -translate-x-1/2 -translate-y-1/2" /><span class="absolute right-2 bottom-2 left-2 text-center text-xs">2,200-character video caption</span></div>
				<div class="aspect-[4/5] rounded-lg border bg-muted/20 p-3"><div class="grid grid-cols-2 gap-1">{#each [1, 2, 3, 4] as item (item)}<span class="aspect-square rounded bg-primary/15"></span>{/each}</div><p class="mt-4 text-center text-xs">Up to 35 photos · 4,000 characters</p></div>
			</div>
		{:else}
			<div>
				<div class="relative aspect-video overflow-hidden rounded-lg border bg-primary/10">
					<Play class="absolute top-1/2 left-1/2 size-9 -translate-x-1/2 -translate-y-1/2" />
					<span class="absolute right-3 bottom-3 rounded bg-background/80 px-2 py-1 font-mono text-[0.65rem]">08:42</span>
				</div>
				<div class="mt-3 flex items-start justify-between gap-4"><div><p class="text-sm font-semibold">{platform.preview.headline}</p><p class="mt-1 text-xs text-muted-foreground">Title · description · privacy · playlist</p></div><span class="rounded-full border px-2 py-1 text-[0.65rem]">Private</span></div>
			</div>
		{/if}

		{#if !['mastodon', 'linkedin', 'threads', 'facebook', 'instagram', 'tiktok', 'youtube'].includes(platform.slug)}
			<p class="mt-4 text-xs leading-5 text-muted-foreground">{platform.preview.body}</p>
		{/if}
	</div>
</div>
