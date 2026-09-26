<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import {
		SocialPreview,
		SocialPreviewPage,
		createPreviewModel,
		platformNames,
		previewCapabilities,
		previewPlatforms,
		supportsPreviewFormat,
		type PreviewCard,
		type PreviewBusinessPost,
		type PreviewFormat,
		type PreviewMedia,
		type PreviewMediaKind,
		type PreviewPlatform
	} from '@openpost/social-preview';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ImagePlus from '@lucide/svelte/icons/image-plus';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import * as Sheet from '$lib/components/ui/sheet';
	import { Textarea } from '$lib/components/ui/textarea';
	import AppSelect from '$lib/components/app-select.svelte';

	interface LocalMedia extends PreviewMedia {
		name: string;
		local: true;
	}

	let { initialPlatform = 'x' }: { initialPlatform?: PreviewPlatform } = $props();
	let selectedPlatform = $state<PreviewPlatform>(untrack(() => initialPlatform));
	let previewMode = $state('page');
	let previewWidth = $state('390');
	let previewScheme = $state<'light' | 'dark'>('light');
	let business = $state<PreviewBusinessPost>({ topic: 'standard' });
	let avatarUrl = $state('');
	let verified = $state(false);
	let location = $state('');
	let subtitle = $state('');
	let cardTitle = $state('');
	let cardDescription = $state('');
	let cardImage = $state('');
	let pollDuration = $state('1 day');
	let selectedFormat = $state<PreviewFormat>(
		untrack(() => previewCapabilities[initialPlatform].formats[0])
	);
	let author = $state('OpenPost');
	let handle = $state('openpost');
	let draft = $state(
		'One shared draft can become a better post for each account. Tailor the text, check the preview, then schedule it.'
	);
	let localMedia = $state<LocalMedia[]>([]);
	let publicMediaUrl = $state('');
	let publicMediaKind = $state<PreviewMediaKind>('image');
	let altText = $state('');
	let pollEnabled = $state(false);
	let pollOptions = $state('First option\nSecond option');
	let contentWarning = $state('');
	let linkUrl = $state('');
	let cardKind = $state<PreviewCard['kind']>('link');
	let formatTitle = $state('Your post title');
	let mediaError = $state('');
	let localMediaInput = $state<HTMLInputElement | null>(null);
	let optionsOpen = $state(false);

	const capability = $derived(previewCapabilities[selectedPlatform]);
	const TOOL_IMAGE_LIMIT = 35;
	const supportsMultipleAttachments = $derived(
		['discord', 'telegram', 'threads'].includes(selectedPlatform) ||
			(selectedPlatform === 'instagram' && selectedFormat === 'post')
	);
	const parsedPollOptions = $derived(
		pollOptions
			.split(/\n/u)
			.map((option) => option.trim())
			.filter(Boolean)
	);
	const imageLimit = $derived(
		selectedFormat === 'story' ? 1 : (capability.maxImages ?? TOOL_IMAGE_LIMIT)
	);
	const attachmentLimit = $derived(
		supportsMultipleAttachments ? (capability.maxImages ?? TOOL_IMAGE_LIMIT) : imageLimit
	);
	const pollLimit = $derived(capability.maxPollOptions ?? 4);
	const isFacebookVideo = $derived(
		selectedPlatform === 'facebook' && ['video', 'reel'].includes(selectedFormat)
	);
	const hasTitle = $derived(
		['youtube', 'peertube', 'pinterest', 'reddit', 'lemmy', 'piefed', 'googlebusiness'].includes(
			selectedPlatform
		) || selectedFormat === 'document'
	);
	const pollSupported = $derived(capability.polls && ['post', 'thread'].includes(selectedFormat));
	const formatOptions = $derived(capability.formats);
	const allowedMediaKinds = $derived(mediaKindsFor(selectedPlatform, selectedFormat));
	const selectionWarning = $derived.by(() => {
		if (localMedia.some((media) => !allowedMediaKinds.includes(media.kind)))
			return 'Some files do not match this format and are hidden from the preview. Your files have been kept. Change the format or remove them in Post details.';
		if (localMedia.length > attachmentLimit)
			return `This selection exceeds the ${attachmentLimit}-${supportsMultipleAttachments ? 'item' : 'image'} preview limit. Remove ${localMedia.length - attachmentLimit} item(s) in Post details. Your files have been kept.`;
		if (
			!supportsMultipleAttachments &&
			localMedia.length > 1 &&
			localMedia.some((media) => media.kind !== 'image')
		)
			return 'This format previews one video or document at a time. Your files have been kept. Remove extra files in Post details.';
		if (
			selectedPlatform === 'telegram' &&
			localMedia.some((media) => media.kind === 'document') &&
			localMedia.some((media) => media.kind !== 'document')
		)
			return 'Telegram document albums cannot mix with photos or videos. Your files have been kept. Remove one media type in Post details.';
		return '';
	});
	const availableCardKinds = $derived(capability.cards ?? []);
	const mediaAccept = $derived(
		[
			allowedMediaKinds.includes('image') ? 'image/*' : '',
			allowedMediaKinds.includes('video') ? 'video/*' : '',
			allowedMediaKinds.includes('document') ? 'application/pdf' : ''
		]
			.filter(Boolean)
			.join(',')
	);
	const mediaHint = $derived(
		supportsMultipleAttachments
			? `up to ${attachmentLimit} ${allowedMediaKinds.join(', ')} attachments`
			: mediaKindLabel(allowedMediaKinds)
	);
	const activeOptionCount = $derived(
		Number(author !== 'OpenPost' || handle !== 'openpost' || avatarUrl !== '' || verified) +
			Number(pollEnabled) +
			Number(Boolean(contentWarning.trim())) +
			Number(Boolean(linkUrl.trim())) +
			Number(localMedia.length > 0 || Boolean(publicMediaUrl.trim())) +
			Number(Boolean(altText.trim())) +
			Number(Boolean(location || subtitle)) +
			Number(selectedPlatform === 'googlebusiness' && business.topic !== 'standard')
	);
	const previewSegments = $derived.by(() => {
		const parts =
			selectedFormat === 'thread'
				? draft
						.split(/\n\s*---+\s*\n/gu)
						.map((part) => part.trim())
						.filter(Boolean)
				: [draft];
		return (parts.length > 0 ? parts : ['']).map((text, index) => ({
			id: `preview-${index}`,
			text
		}));
	});
	const previewMedia = $derived.by<PreviewMedia[]>(() => {
		if (pollEnabled && pollSupported) return [];
		if (localMedia.length > 0) {
			return localMedia
				.filter((media) => allowedMediaKinds.includes(media.kind))
				.map((media) => ({ ...media, alt: media.alt || altText }));
		}
		const url = publicMediaUrl.trim();
		if (!url) return [];
		return [
			{
				id: 'public-media',
				kind: publicMediaKind,
				src: url,
				alt: altText
			}
		];
	});
	const previewModel = $derived(
		createPreviewModel({
			platform: selectedPlatform,
			format: selectedFormat,
			identity: {
				displayName: author,
				handle,
				avatarUrl: avatarUrl || undefined,
				verified
			},
			segments: previewSegments,
			media: previewMedia,
			poll:
				pollEnabled && pollSupported
					? {
							options: parsedPollOptions,
							durationLabel: pollDuration
						}
					: undefined,
			card:
				linkUrl.trim() && availableCardKinds.includes(cardKind)
					? {
							kind: cardKind,
							title:
								cardTitle ||
								(cardKind === 'quote' ? 'Quoted post' : safeDomain(linkUrl) || 'Shared link'),
							domain: safeDomain(linkUrl),
							description: cardDescription,
							imageUrl: cardImage || undefined
						}
					: undefined,
			contentWarning:
				capability.contentWarning && contentWarning.trim() ? contentWarning.trim() : undefined,
			title: hasTitle ? formatTitle : undefined,
			subtitle: subtitle || undefined,
			location: location || undefined,
			business: selectedPlatform === 'googlebusiness' ? business : undefined
		})
	);

	function choosePlatform(value: string) {
		// SAFETY: choosePlatform receives values from the preview platform options rendered by this component.
		selectedPlatform = value as PreviewPlatform;
		if (!supportsPreviewFormat(selectedPlatform, selectedFormat)) {
			selectedFormat = previewCapabilities[selectedPlatform].formats[0];
		}
		if (!previewCapabilities[selectedPlatform].polls) pollEnabled = false;
		if (!previewCapabilities[selectedPlatform].cards?.includes(cardKind)) {
			cardKind = previewCapabilities[selectedPlatform].cards?.[0] ?? 'link';
		}
		reconcileMediaSelection();
	}

	function chooseFormat(value: string) {
		// SAFETY: chooseFormat receives values from previewCapabilities[selectedPlatform].formats.
		selectedFormat = value as PreviewFormat;
		if (selectedFormat === 'document' && formatTitle === 'Your post title') {
			formatTitle = 'Your document title';
		}
		if (
			(selectedFormat === 'video' || selectedFormat === 'short') &&
			formatTitle === 'Your document title'
		) {
			formatTitle = 'Your post title';
		}
		reconcileMediaSelection();
	}

	function chooseFiles(event: Event) {
		// SAFETY: chooseFiles is bound to the file input change event in this component.
		const input = event.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		mediaError = '';
		if (files.length === 0) return;
		const kinds = files.map(mediaKindForFile);
		if (kinds.some((kind) => kind === null || !allowedMediaKinds.includes(kind))) {
			mediaError = `This format accepts ${mediaHint}.`;
			input.value = '';
			return;
		}
		if (
			!supportsMultipleAttachments &&
			kinds.some((kind) => kind === 'video' || kind === 'document') &&
			files.length > 1
		) {
			mediaError = `Choose one video or document, or up to ${imageLimit} images.`;
			input.value = '';
			return;
		}
		if (
			selectedPlatform === 'telegram' &&
			kinds.includes('document') &&
			kinds.some((kind) => kind !== 'document')
		) {
			mediaError =
				'Choose a document album, or an album of photos and videos. Telegram does not mix documents with other media.';
			input.value = '';
			return;
		}
		if (files.length > attachmentLimit) {
			mediaError = `Choose up to ${attachmentLimit} ${supportsMultipleAttachments ? 'media items' : 'images'} for this preview. Your current media is unchanged.`;
			input.value = '';
			return;
		}
		clearLocalMedia();
		localMedia = files.map((file, index) => ({
			id: `local-${index}-${file.name}`,
			name: file.name,
			local: true,
			kind: mediaKindForFile(file) ?? 'image',
			src: URL.createObjectURL(file),
			alt: altText
		}));
		input.value = '';
	}

	function reconcileMediaSelection() {
		const allowed = mediaKindsFor(selectedPlatform, selectedFormat);

		if (!allowed.includes(publicMediaKind)) {
			publicMediaKind = allowed[0] ?? 'image';
			publicMediaUrl = '';
		}
		mediaError = '';
	}

	function mediaKindsFor(platform: PreviewPlatform, format: PreviewFormat): PreviewMediaKind[] {
		const supported = previewCapabilities[platform].media;
		if (format === 'document') return supported.includes('document') ? ['document'] : [];
		if (format === 'photo') return supported.includes('image') ? ['image'] : [];
		if (format === 'video' || format === 'short' || format === 'reel') {
			return supported.includes('video') ? ['video'] : [];
		}
		if (format === 'story') {
			return supported.filter(
				(kind): kind is PreviewMediaKind => kind === 'image' || kind === 'video'
			);
		}
		return [...supported];
	}

	function mediaKindForFile(file: File): PreviewMediaKind | null {
		if (file.type.startsWith('image/')) return 'image';
		if (file.type.startsWith('video/')) return 'video';
		if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
			return 'document';
		}
		return null;
	}

	function mediaKindLabel(kinds: readonly PreviewMediaKind[]): string {
		const labels = kinds.map((kind) =>
			kind === 'document'
				? 'one PDF document'
				: kind === 'video'
					? 'one video'
					: `up to ${imageLimit} images`
		);
		if (labels.length === 0) return 'no media';
		if (labels.length === 1) return labels[0];
		return `${labels.slice(0, -1).join(', ')}, or ${labels.at(-1)}`;
	}

	function moveMedia(index: number, direction: -1 | 1) {
		const next = index + direction;
		if (next < 0 || next >= localMedia.length) return;
		const reordered = [...localMedia];
		[reordered[index], reordered[next]] = [reordered[next], reordered[index]];
		localMedia = reordered;
	}

	function removeMedia(id: string) {
		const item = localMedia.find((media) => media.id === id);
		if (item) URL.revokeObjectURL(item.src);
		localMedia = localMedia.filter((media) => media.id !== id);
	}

	function clearLocalMedia() {
		for (const media of localMedia) URL.revokeObjectURL(media.src);
		localMedia = [];
	}

	function safeDomain(value: string): string {
		try {
			return new URL(value).hostname.replace(/^www\./u, '');
		} catch {
			return '';
		}
	}

	onDestroy(clearLocalMedia);
</script>

{#snippet advancedOptions()}
	<div class="grid gap-6">
		<section class="grid gap-4" aria-labelledby="preview-account-options">
			<div>
				<h3 id="preview-account-options" class="text-sm font-semibold">Account</h3>
				<p class="mt-1 text-xs leading-5 text-muted-foreground">
					Use the name and handle that people will see on the destination.
				</p>
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<label class="grid gap-2 text-sm font-medium" for="preview-author">
					Display name
					<Input id="preview-author" bind:value={author} class="h-11" maxlength={80} />
				</label>
				<label class="grid gap-2 text-sm font-medium" for="preview-handle">
					Handle
					<Input id="preview-handle" bind:value={handle} class="h-11" maxlength={100} />
				</label>
			</div>
			<label class="grid gap-2 text-sm font-medium" for="preview-avatar"
				>Avatar URL<Input
					id="preview-avatar"
					type="url"
					class="h-11"
					bind:value={avatarUrl}
					placeholder="https://example.com/avatar.jpg"
				/></label
			>
			<label class="flex min-h-11 items-center gap-3 text-sm font-medium"
				><Checkbox bind:checked={verified} />Verified badge</label
			>
			<label class="grid gap-2 text-sm font-medium" for="preview-context">
				{isFacebookVideo ? 'Video description' : 'Community, channel, or subtitle'}
				{#if isFacebookVideo}<Textarea
						id="preview-context"
						class="min-h-24 p-3 leading-6"
						bind:value={subtitle}
						placeholder="Describe your video"
					/>{:else}<Input
						id="preview-context"
						class="h-11"
						bind:value={subtitle}
						placeholder="Optional context"
					/>{/if}
			</label>
			<label class="grid gap-2 text-sm font-medium" for="preview-location"
				>Location<Input
					id="preview-location"
					class="h-11"
					bind:value={location}
					placeholder="Optional location"
				/></label
			>
		</section>

		{#if selectedPlatform === 'googlebusiness'}
			<section class="grid gap-4 border-t pt-5" aria-labelledby="business-options-title">
				<h3 id="business-options-title" class="text-sm font-semibold">Business update</h3>
				<div class="grid gap-2">
					<label for="business-topic" class="text-sm font-medium">Update type</label><AppSelect
						id="business-topic"
						value={business.topic}
						options={[
							{ value: 'standard', label: 'Update' },
							{ value: 'event', label: 'Event' },
							{ value: 'offer', label: 'Offer' }
						]}
						ariaLabel="Business update type"
						class="h-11 w-full md:h-11"
						onValueChange={(value) => (business.topic = value as PreviewBusinessPost['topic'])}
					/>
				</div>
				{#if business.topic !== 'standard'}
					<div class="grid gap-4 sm:grid-cols-2">
						<label for="business-start" class="grid gap-2 text-sm font-medium"
							>Start date<Input
								id="business-start"
								type="date"
								class="h-11"
								bind:value={business.startDate}
							/></label
						><label for="business-end" class="grid gap-2 text-sm font-medium"
							>End date<Input
								id="business-end"
								type="date"
								class="h-11"
								bind:value={business.endDate}
							/></label
						>
					</div>
				{/if}
				{#if business.topic === 'event'}
					<div class="grid gap-4 sm:grid-cols-2">
						<label for="business-start-time" class="grid gap-2 text-sm font-medium"
							>Start time<Input
								id="business-start-time"
								type="time"
								class="h-11"
								bind:value={business.startTime}
							/></label
						><label for="business-end-time" class="grid gap-2 text-sm font-medium"
							>End time<Input
								id="business-end-time"
								type="time"
								class="h-11"
								bind:value={business.endTime}
							/></label
						>
					</div>
				{/if}
				{#if business.topic === 'offer'}
					<label for="business-coupon" class="grid gap-2 text-sm font-medium"
						>Coupon code<Input
							id="business-coupon"
							class="h-11"
							bind:value={business.couponCode}
						/></label
					><label for="business-terms" class="grid gap-2 text-sm font-medium"
						>Offer terms<Textarea
							id="business-terms"
							class="min-h-20 p-3"
							bind:value={business.terms}
						/></label
					>
				{/if}
				<div class="grid gap-2">
					<label for="business-action" class="text-sm font-medium">Button</label><AppSelect
						id="business-action"
						value={business.action ?? 'none'}
						options={[
							{ value: 'none', label: 'No button' },
							{ value: 'book', label: 'Book' },
							{ value: 'order', label: 'Order online' },
							{ value: 'shop', label: 'Shop' },
							{ value: 'learn_more', label: 'Learn more' },
							{ value: 'sign_up', label: 'Sign up' },
							{ value: 'call', label: 'Call now' }
						]}
						ariaLabel="Business action"
						class="h-11 w-full md:h-11"
						onValueChange={(value) =>
							(business.action =
								value === 'none' ? undefined : (value as PreviewBusinessPost['action']))}
					/>
				</div>
				{#if business.action}<label for="business-action-url" class="grid gap-2 text-sm font-medium"
						>Button URL<Input
							id="business-action-url"
							type="url"
							class="h-11"
							bind:value={business.actionUrl}
						/></label
					>{/if}
			</section>
		{/if}

		{#if pollSupported}
			<section class="grid gap-4 border-t pt-5" aria-labelledby="preview-poll-options">
				<div>
					<h3 id="preview-poll-options" class="text-sm font-semibold">Poll</h3>
					<p class="mt-1 text-xs leading-5 text-muted-foreground">
						Polls replace media on platforms that support them.
					</p>
				</div>
				<label class="flex min-h-11 items-center gap-3 text-sm font-medium">
					<Checkbox bind:checked={pollEnabled} />
					Include a poll
				</label>
				{#if pollEnabled}
					<label class="grid gap-2 text-sm font-medium" for="preview-poll">
						Poll options, up to {pollLimit}
						<Textarea
							id="preview-poll"
							bind:value={pollOptions}
							class="min-h-24 p-3 leading-6"
							placeholder="One option per line"
						/>
					</label>
					{#if parsedPollOptions.length > pollLimit}<p
							role="alert"
							class="text-sm text-destructive"
						>
							This poll has {parsedPollOptions.length} options. Remove {parsedPollOptions.length -
								pollLimit} to meet the {pollLimit}-option preview limit. All options remain visible
							for editing.
						</p>{/if}
					<label class="grid gap-2 text-sm font-medium" for="preview-poll-duration"
						>Poll duration<Input
							id="preview-poll-duration"
							class="h-11"
							bind:value={pollDuration}
						/></label
					>
				{/if}
			</section>
		{/if}

		{#if capability.contentWarning || availableCardKinds.length > 0}
			<section class="grid gap-4 border-t pt-5" aria-labelledby="preview-post-options">
				<div>
					<h3 id="preview-post-options" class="text-sm font-semibold">Post details</h3>
					<p class="mt-1 text-xs leading-5 text-muted-foreground">
						Add the destination-specific details that affect the final post.
					</p>
				</div>
				{#if capability.contentWarning}
					<label class="grid gap-2 text-sm font-medium" for="preview-warning">
						Content warning
						<Input
							id="preview-warning"
							bind:value={contentWarning}
							class="h-11"
							placeholder="Optional warning"
						/>
					</label>
				{/if}

				{#if availableCardKinds.length > 0}
					{#if availableCardKinds.length > 1}
						<div class="grid gap-2">
							<label class="text-sm font-medium" for="preview-card-kind">Card type</label>
							<AppSelect
								id="preview-card-kind"
								value={cardKind}
								options={availableCardKinds.map((kind) => ({
									value: kind,
									label: kind === 'quote' ? 'Quoted post' : 'Link card'
								}))}
								class="h-11 w-full md:h-11"
								ariaLabel="Card type"
								onValueChange={(value) => (cardKind = value as PreviewCard['kind'])}
							/>
						</div>
					{/if}
					<label class="grid gap-2 text-sm font-medium" for="preview-link">
						{cardKind === 'quote' ? 'Quoted post URL' : 'Link card URL'}
						<Input
							id="preview-link"
							type="url"
							bind:value={linkUrl}
							class="h-11"
							placeholder="https://example.com/article"
						/>
					</label>
					<label class="grid gap-2 text-sm font-medium" for="preview-card-title"
						>Card title<Input id="preview-card-title" class="h-11" bind:value={cardTitle} /></label
					>
					<label class="grid gap-2 text-sm font-medium" for="preview-card-description"
						>{cardKind === 'quote' ? 'Quoted text' : 'Card description'}<Textarea
							id="preview-card-description"
							class="min-h-20 p-3"
							bind:value={cardDescription}
						/></label
					>
					<label class="grid gap-2 text-sm font-medium" for="preview-card-image"
						>Card image URL<Input
							id="preview-card-image"
							type="url"
							class="h-11"
							bind:value={cardImage}
						/></label
					>
					<p class="text-xs leading-5 text-muted-foreground">
						Enter the card details yourself. This tool does not fetch page metadata.
					</p>
				{/if}
			</section>
		{/if}

		<section class="grid gap-4 border-t pt-5" aria-labelledby="preview-media-options">
			<div>
				<h3 id="preview-media-options" class="text-sm font-semibold">Media</h3>
				<p class="mt-1 text-xs leading-5 text-muted-foreground">
					This preview accepts {mediaHint}. {capability.maxImages === undefined
						? 'Image count is a tool limit; network or server limits may differ.'
						: ''}
				</p>
			</div>
			<div>
				<label for="preview-local-media" class="text-sm font-medium">Local media</label>
				<Input
					bind:ref={localMediaInput}
					id="preview-local-media"
					type="file"
					accept={mediaAccept}
					multiple
					onchange={chooseFiles}
					class="sr-only !size-px !p-0"
				/>
				<Button
					type="button"
					variant="outline"
					class="mt-2 h-11 w-full justify-start md:h-11"
					onclick={() => localMediaInput?.click()}
				>
					<ImagePlus data-icon="inline-start" />
					Choose local media
				</Button>
				<p class="mt-2 text-xs leading-5 text-muted-foreground">Files stay in this browser.</p>
				{#if mediaError}<p role="alert" class="mt-2 text-sm text-destructive">
						{mediaError}
					</p>{/if}
				{#if localMedia.length > 0}
					<ul class="mt-2 grid gap-1">
						{#each localMedia as media, index (media.id)}
							<li class="grid gap-2 rounded-md bg-muted p-3 text-xs">
								<div class="flex min-w-0 items-center gap-2">
									<span class="min-w-0 flex-1 truncate">{media.name}</span>
									<Button
										variant="ghost"
										size="icon"
										class="size-11 shrink-0"
										aria-label={`Move ${media.name} earlier`}
										disabled={index === 0}
										onclick={() => moveMedia(index, -1)}><ArrowUp class="size-4" /></Button
									>
									<Button
										variant="ghost"
										size="icon"
										class="size-11 shrink-0"
										aria-label={`Move ${media.name} later`}
										disabled={index === localMedia.length - 1}
										onclick={() => moveMedia(index, 1)}><ArrowDown class="size-4" /></Button
									>
									<button
										type="button"
										class="focus-ring grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-foreground"
										aria-label={`Remove ${media.name}`}
										onclick={() => removeMedia(media.id)}
									>
										<Trash2 class="size-4" />
									</button>
								</div>
								<label class="grid gap-2" for={`media-alt-${index}`}
									>Alt text for this item<Input
										id={`media-alt-${index}`}
										class="h-11"
										bind:value={media.alt}
										placeholder="Use the shared alt text, or add a description"
									/></label
								>
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			{#if localMedia.length === 0}
				<div class="grid gap-3 rounded-lg bg-muted/45 p-3">
					<label class="grid gap-2 text-sm font-medium" for="preview-media-url">
						Or use a public media URL
						<Input
							id="preview-media-url"
							type="url"
							bind:value={publicMediaUrl}
							class="h-11"
							placeholder="https://example.com/media.jpg"
						/>
					</label>
					<div class="grid gap-2">
						<label class="text-sm font-medium" for="preview-media-kind">Media type</label>
						<AppSelect
							id="preview-media-kind"
							value={publicMediaKind}
							options={allowedMediaKinds.map((kind) => ({
								value: kind,
								label: kind === 'document' ? 'PDF document' : kind === 'video' ? 'Video' : 'Image'
							}))}
							class="h-11 w-full md:h-11"
							ariaLabel="Media type"
							onValueChange={(value) => (publicMediaKind = value as PreviewMediaKind)}
						/>
					</div>
				</div>
			{/if}

			<label class="grid gap-2 text-sm font-medium" for="preview-alt-text">
				Media alt text
				<Textarea
					id="preview-alt-text"
					bind:value={altText}
					class="min-h-20 p-3 leading-6"
					placeholder="Describe the useful content..."
				/>
			</label>
		</section>
	</div>
{/snippet}

<div class="mt-8 grid min-w-0 items-start gap-5 xl:grid-cols-[24rem_minmax(0,1fr)]">
	<section
		class="min-w-0 rounded-xl border bg-card p-4 sm:p-6"
		aria-labelledby="preview-controls-title"
	>
		<h2 id="preview-controls-title" class="text-lg font-semibold">Write your post</h2>
		<p class="mt-1 text-sm leading-6 text-muted-foreground">
			Preview native formats. Publishing availability in OpenPost may differ.
		</p>

		<div class="mt-5 grid gap-4">
			<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
				<div class="grid gap-2">
					<label class="text-sm font-medium" for="preview-platform">Platform</label>
					<AppSelect
						id="preview-platform"
						value={selectedPlatform}
						options={previewPlatforms.map((platform) => ({
							value: platform,
							label: platformNames[platform]
						}))}
						class="h-11 w-full md:h-11"
						ariaLabel="Platform"
						onValueChange={choosePlatform}
					/>
				</div>
				<div class="grid gap-2">
					<label class="text-sm font-medium" for="preview-format">Format</label>
					<AppSelect
						id="preview-format"
						value={selectedFormat}
						options={formatOptions.map((format) => ({
							value: format,
							label: format.replace('_', ' ')
						}))}
						class="h-11 w-full capitalize md:h-11"
						ariaLabel="Format"
						onValueChange={chooseFormat}
					/>
				</div>
			</div>

			{#if hasTitle}
				<label class="grid gap-2 text-sm font-medium" for="preview-title">
					{selectedFormat === 'document' ? 'Document title' : 'Post title'}
					<Input id="preview-title" bind:value={formatTitle} class="h-11" />
				</label>
			{/if}

			{#if selectedFormat === 'story'}
				<p class="text-sm leading-6 text-muted-foreground">
					Text must be part of your image or video.
				</p>
			{:else}
				<label class="grid gap-2 text-sm font-medium" for="preview-copy">
					Post copy
					<Textarea
						id="preview-copy"
						bind:value={draft}
						class="min-h-36 p-3 leading-6"
						placeholder="Write the post you want to preview..."
					/>
				</label>
			{/if}
			{#if selectionWarning}<p role="alert" class="text-sm leading-5 text-destructive">
					{selectionWarning}
				</p>{/if}
			{#if pollEnabled && pollSupported && parsedPollOptions.length > pollLimit}<p
					role="status"
					class="text-sm leading-5 text-destructive"
				>
					The poll exceeds the {pollLimit}-option preview limit. Edit Post details to remove extra
					options.
				</p>{/if}

			{#if selectedFormat === 'thread'}
				<p class="text-xs leading-5 text-muted-foreground">
					Put <strong>---</strong> on its own line between posts.
				</p>
			{/if}

			<div class="border-t pt-4">
				<Button
					type="button"
					variant="outline"
					class="h-auto min-h-11 w-full justify-between gap-3 px-3 py-2.5 text-left whitespace-normal md:h-auto"
					onclick={() => (optionsOpen = true)}
				>
					<span class="flex min-w-0 items-center gap-2.5">
						<SlidersHorizontal class="size-4 shrink-0" />
						<span class="grid min-w-0 gap-0.5">
							<strong class="text-sm">Post details</strong>
							<small class="font-normal text-muted-foreground">
								{activeOptionCount > 0
									? `${activeOptionCount} custom option${activeOptionCount === 1 ? '' : 's'}`
									: 'Optional details'}
							</small>
						</span>
					</span>
					<span aria-hidden="true">Edit</span>
				</Button>
			</div>
		</div>
	</section>

	<section
		class="grid min-h-[32rem] min-w-0 place-items-center self-start rounded-xl bg-muted/20 p-3 sm:p-6 xl:sticky xl:top-24"
		aria-labelledby="destination-preview-title"
	>
		<div class="grid w-full place-items-center gap-4">
			<div class="flex w-full max-w-2xl flex-wrap items-center justify-between gap-3">
				<div>
					<h2 id="destination-preview-title" class="text-lg font-semibold">Post preview</h2>
					<p class="mt-1 text-sm text-muted-foreground">Social network designs can change.</p>
				</div>
				{#if previewMedia.length > 0}
					<span class="inline-flex items-center gap-2 text-xs text-muted-foreground">
						<ImagePlus class="size-4 text-primary" />
						{previewMedia.length} media item{previewMedia.length === 1 ? '' : 's'}
					</span>
				{/if}
			</div>
			<div class="grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
				<div class="grid gap-2">
					<label for="preview-mode" class="text-sm font-medium">View</label><AppSelect
						id="preview-mode"
						value={previewMode}
						options={[
							{ value: 'page', label: 'Full page' },
							{ value: 'card', label: 'Post card' }
						]}
						ariaLabel="Preview view"
						class="h-11 w-full md:h-11"
						onValueChange={(value) => (previewMode = value)}
					/>
				</div>
				<div class="grid gap-2">
					<label for="preview-width" class="text-sm font-medium">Screen width</label><AppSelect
						id="preview-width"
						value={previewWidth}
						options={[
							{ value: '320', label: 'Small phone · 320px' },
							{ value: '390', label: 'Phone · 390px' },
							{ value: '768', label: 'Tablet · 768px' },
							{ value: '1200', label: 'Desktop · 1200px' }
						]}
						ariaLabel="Preview screen width"
						class="h-11 w-full md:h-11"
						onValueChange={(value) => (previewWidth = value)}
					/>
				</div>
				<div class="grid gap-2">
					<label for="preview-scheme" class="text-sm font-medium">Appearance</label><AppSelect
						id="preview-scheme"
						value={previewScheme}
						options={[
							{ value: 'light', label: 'Light' },
							{ value: 'dark', label: 'Dark' }
						]}
						ariaLabel="Preview appearance"
						class="h-11 w-full md:h-11"
						onValueChange={(value) => (previewScheme = value as 'light' | 'dark')}
					/>
				</div>
			</div>
			<p class="w-full text-xs leading-5 text-muted-foreground">
				Scroll the preview sideways when the selected screen is wider than this workspace. All
				names, counts, and surrounding posts are illustrative.
			</p>
			<!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need to scroll a wide preview.) -->
			<div
				class="w-full min-w-0 overflow-x-auto rounded-lg border focus-visible:outline-2 focus-visible:outline-ring"
				role="region"
				aria-label="Scrollable social preview"
				tabindex="0"
			>
				<div style:width={`${previewWidth}px`} class="mx-auto min-h-96" data-preview-viewport>
					{#if previewMode === 'page'}<SocialPreviewPage
							model={previewModel}
							scheme={previewScheme}
						/>{:else}<SocialPreview model={previewModel} scheme={previewScheme} />{/if}
				</div>
			</div>
		</div>
	</section>
</div>

<Sheet.Root bind:open={optionsOpen}>
	<Sheet.Content
		side="right"
		class="w-full! gap-0 p-0 sm:max-w-xl!"
		aria-describedby="preview-options-description"
	>
		<Sheet.Header class="border-b px-5 py-5 pr-16 text-left sm:px-6">
			<Sheet.Title>Preview options</Sheet.Title>
			<Sheet.Description id="preview-options-description">
				Add destination-specific context without changing the preview workspace.
			</Sheet.Description>
		</Sheet.Header>
		<div class="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-6">
			{@render advancedOptions()}
		</div>
		<Sheet.Footer class="border-t px-5 py-4 sm:px-6">
			<Button type="button" class="w-full" onclick={() => (optionsOpen = false)}>
				View preview
			</Button>
		</Sheet.Footer>
	</Sheet.Content>
</Sheet.Root>
