<script lang="ts">
	import {
		SocialPreview,
		createPreviewModel,
		platformNames,
		previewPlatforms,
		type PreviewPlatform
	} from '@openpost/social-preview';
	import Check from 'lucide-svelte/icons/check';
	import ImageIcon from 'lucide-svelte/icons/image';
	import PlatformIcon from '$lib/components/platform-icon.svelte';

	let selectedPlatform = $state<PreviewPlatform>('linkedin');
	let includeMedia = $state(true);
	let mobilePane = $state<'edit' | 'preview'>('preview');
	let destinationCopy = $state<Record<PreviewPlatform, string>>({
		x: 'A calmer way to publish across every destination. Customize the details, check the preview, then schedule.',
		mastodon:
			'A calmer way to publish across every destination.\n\nCustomize the details, check the preview, then schedule.',
		bluesky:
			'A calmer way to publish across every destination. Check the details before it leaves the queue.',
		linkedin:
			'Publishing across several networks should not flatten every post into the same copy.\n\nOpenPost keeps one source and lets you review the destination version before scheduling.',
		threads: 'One source. A version for every destination. A preview before anything publishes.',
		instagram:
			'One source, adapted for the destination.\n\nReview the crop, caption, and format before you schedule.',
		facebook:
			'Prepare one publication, adapt it for Facebook, and see the result before it enters the queue.',
		youtube: 'OpenPost destination previews',
		tiktok: 'Review the caption, cover, and vertical crop before this video is scheduled.',
		discord: 'OpenPost keeps destination copy, media, and delivery state together.'
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
								alt: 'OpenPost composer showing destination controls'
							}
						]
					: [],
			title: selectedPlatform === 'youtube' ? 'Create once, preview every destination' : undefined,
			subtitle: selectedPlatform === 'youtube' ? 'OpenPost product tour' : undefined
		})
	);

	function choosePlatform(platform: PreviewPlatform) {
		selectedPlatform = platform;
		includeMedia = platform !== 'youtube';
	}

	function updateCopy(event: Event) {
		destinationCopy[selectedPlatform] = (event.currentTarget as HTMLTextAreaElement).value;
	}
</script>

<div class="overflow-hidden rounded-2xl border bg-card">
	<div class="flex min-h-12 items-center justify-between gap-3 border-b px-4">
		<div class="flex items-center gap-2 text-sm font-medium">
			<span class="size-2 rounded-full bg-primary" aria-hidden="true"></span>
			Destination editor
		</div>
		<span class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
			<Check class="size-3.5 text-primary" aria-hidden="true" />
			Draft saved
		</span>
	</div>

	<div class="border-b">
		<div class="flex snap-x gap-1 overflow-x-auto p-2" aria-label="Choose a destination">
			{#each previewPlatforms as platform (platform)}
				<button
					type="button"
					class={[
						'focus-ring flex min-h-11 shrink-0 snap-start items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors',
						selectedPlatform === platform
							? 'bg-foreground text-background'
							: 'text-muted-foreground hover:bg-muted hover:text-foreground'
					]}
					aria-pressed={selectedPlatform === platform}
					onclick={() => choosePlatform(platform)}
				>
					<PlatformIcon {platform} class="size-4" />
					{platformNames[platform]}
				</button>
			{/each}
		</div>
	</div>

	<div class="grid grid-cols-2 gap-1 border-b p-2 lg:hidden" aria-label="Destination demo view">
		<button
			type="button"
			class={[
				'focus-ring min-h-11 rounded-lg text-sm font-medium',
				mobilePane === 'edit' ? 'bg-foreground text-background' : 'text-muted-foreground'
			]}
			aria-pressed={mobilePane === 'edit'}
			onclick={() => (mobilePane = 'edit')}
		>
			Edit destination
		</button>
		<button
			type="button"
			class={[
				'focus-ring min-h-11 rounded-lg text-sm font-medium',
				mobilePane === 'preview' ? 'bg-foreground text-background' : 'text-muted-foreground'
			]}
			aria-pressed={mobilePane === 'preview'}
			onclick={() => (mobilePane = 'preview')}
		>
			View preview
		</button>
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
					<p class="text-xs font-medium text-primary">Customized version</p>
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
				<textarea
					value={destinationCopy[selectedPlatform]}
					oninput={updateCopy}
					class="min-h-44 resize-y rounded-xl border bg-background p-3 text-sm leading-6"
					aria-label={`${platformNames[selectedPlatform]} post text`}
				></textarea>
			</label>

			<div class="mt-4 flex flex-wrap gap-2">
				<button
					type="button"
					class={[
						'focus-ring inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium',
						includeMedia ? 'border-primary/40 bg-primary/10 text-primary' : 'bg-background'
					]}
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
				</button>
				<span class="inline-flex min-h-11 items-center px-2 text-xs text-muted-foreground">
					Platform settings stay with this destination.
				</span>
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
					<span class="text-xs text-muted-foreground">Approximate provider layout</span>
				</div>
				<SocialPreview model={previewModel} compact />
			</div>
		</section>
	</div>
</div>
