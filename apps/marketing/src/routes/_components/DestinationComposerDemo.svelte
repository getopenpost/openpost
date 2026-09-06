<script lang="ts">
	import {
		SocialPreview,
		createPreviewModel,
		platformNames,
		previewPlatforms,
		type PreviewPlatform
	} from '@openpost/social-preview';
	import ImageIcon from '@lucide/svelte/icons/image';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import { cn } from '$lib/utils';

	let selectedPlatform = $state<PreviewPlatform>('linkedin');
	let includeMedia = $state(true);
	let mobilePane = $state<'edit' | 'preview'>('preview');
	let destinationCopy = $state<Record<PreviewPlatform, string>>({
		x: 'Write one post, change the details for X, check the preview, then schedule it.',
		mastodon:
			'Write one post, change the details for Mastodon, check the preview, then schedule it.',
		bluesky: 'Write one post, change the details for Bluesky, and check it before it goes live.',
		linkedin:
			'Each social network has different rules and readers.\n\nOpenPost keeps one shared draft and lets you review the LinkedIn version before scheduling.',
		threads: 'One shared draft. A version for Threads. A preview before it goes live.',
		instagram:
			'One shared draft, changed for Instagram.\n\nReview the crop, caption, and format before you schedule.',
		facebook: 'Write one post, change it for Facebook, and preview it before you schedule.',
		youtube: 'OpenPost account previews',
		tiktok: 'Review the caption, cover, and vertical crop before this video is scheduled.',
		discord: 'OpenPost keeps the Discord text, media, and posting status together.'
	});

	const format = $derived(
		selectedPlatform === 'youtube'
			? ('video' as const)
			: selectedPlatform === 'tiktok'
				? ('photo' as const)
				: selectedPlatform === 'instagram'
					? ('post' as const)
					: ('post' as const)
	);
	const previewModel = $derived(
		createPreviewModel({
			platform: selectedPlatform,
			format,
			identity: {
				displayName: 'OpenPost',
				handle: 'openpost',
				verified: selectedPlatform === 'linkedin'
			},
			segments: [
				{
					id: 'demo',
					text: destinationCopy[selectedPlatform]
				}
			],
			media:
				includeMedia && selectedPlatform !== 'youtube'
					? [
							{
								id: 'product',
								kind: 'image',
								src: '/assets/screenshots/main-dark.png',
								alt: 'OpenPost composer showing account settings'
							}
						]
					: [],
			title: selectedPlatform === 'youtube' ? 'Write once, preview every account' : undefined,
			subtitle: selectedPlatform === 'youtube' ? 'OpenPost product tour' : undefined
		})
	);

	function choosePlatform(platform: PreviewPlatform) {
		selectedPlatform = platform;
		includeMedia = platform !== 'youtube';
	}

	function updateCopy(event: Event) {
		// SAFETY: updateCopy is bound to textarea input events in this component.
		destinationCopy[selectedPlatform] = (event.currentTarget as HTMLTextAreaElement).value;
	}
</script>

<div class="overflow-hidden rounded-2xl border bg-card">
	<div class="border-b">
		<div class="flex snap-x gap-1 overflow-x-auto p-2" aria-label="Choose an account type">
			{#each previewPlatforms as platform (platform)}
				<Button
					variant="ghost"
					class={cn(
						'focus-ring flex min-h-11 shrink-0 snap-start items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors',
						selectedPlatform === platform
							? 'bg-foreground text-background'
							: 'text-muted-foreground hover:bg-muted hover:text-foreground'
					)}
					aria-pressed={selectedPlatform === platform}
					onclick={() => choosePlatform(platform)}
				>
					<PlatformIcon {platform} class="size-4" />
					{platformNames[platform]}
				</Button>
			{/each}
		</div>
	</div>

	<div class="grid grid-cols-2 gap-1 border-b p-2 lg:hidden" aria-label="Account demo view">
		<Button
			variant="ghost"
			class={cn(
				'focus-ring min-h-11 rounded-lg text-sm font-medium',
				mobilePane === 'edit' ? 'bg-foreground text-background' : 'text-muted-foreground'
			)}
			aria-pressed={mobilePane === 'edit'}
			onclick={() => (mobilePane = 'edit')}
		>
			Edit account version
		</Button>
		<Button
			variant="ghost"
			class={cn(
				'focus-ring min-h-11 rounded-lg text-sm font-medium',
				mobilePane === 'preview' ? 'bg-foreground text-background' : 'text-muted-foreground'
			)}
			aria-pressed={mobilePane === 'preview'}
			onclick={() => (mobilePane = 'preview')}
		>
			View preview
		</Button>
	</div>

	<div class="grid lg:grid-cols-[0.78fr_1.22fr]">
		<section
			class={[
				'border-b bg-muted/30 p-4 sm:p-6 lg:block lg:border-r lg:border-b-0',
				mobilePane === 'edit' ? 'block' : 'hidden'
			]}
			aria-labelledby="destination-copy-title"
		>
			<div class="flex items-start justify-between gap-4">
				<div>
					<p class="text-xs font-medium text-primary">Account version</p>
					<h2 id="destination-copy-title" class="mt-1 font-semibold">
						{platformNames[selectedPlatform]} copy
					</h2>
				</div>
				<span class="rounded-md bg-background px-2 py-1 text-xs text-muted-foreground">
					{destinationCopy[selectedPlatform].length} characters
				</span>
			</div>

			<label class="mt-5 grid gap-2 text-sm font-medium">
				Post text
				<Textarea
					value={destinationCopy[selectedPlatform]}
					oninput={updateCopy}
					class="min-h-44 p-3 text-sm leading-6"
					aria-label={`${platformNames[selectedPlatform]} post text`}
				/>
			</label>

			<div class="mt-4 flex flex-wrap gap-2">
				<Button
					variant="outline"
					class={cn(
						'focus-ring inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium',
						includeMedia ? 'border-primary/40 bg-primary/10 text-primary' : 'bg-background'
					)}
					aria-pressed={includeMedia}
					disabled={selectedPlatform === 'youtube'}
					onclick={() => (includeMedia = !includeMedia)}
				>
					<ImageIcon class="size-4" aria-hidden="true" />
					{selectedPlatform === 'youtube'
						? 'Add video in OpenPost'
						: includeMedia
							? 'Image included'
							: 'Add image'}
				</Button>
			</div>
		</section>

		<section
			class={[
				'min-h-[34rem] place-items-center bg-background p-3 sm:p-6 lg:grid',
				mobilePane === 'preview' ? 'grid' : 'hidden'
			]}
			aria-labelledby="destination-result-title"
		>
			<div class="grid w-full place-items-center gap-3">
				<div class="flex w-full max-w-2xl items-center justify-between gap-3">
					<h2 id="destination-result-title" class="text-sm font-semibold">What people will see</h2>
					<span class="text-xs text-muted-foreground"
						>Preview based on the social network layout</span
					>
				</div>
				<SocialPreview model={previewModel} compact />
			</div>
		</section>
	</div>
</div>
