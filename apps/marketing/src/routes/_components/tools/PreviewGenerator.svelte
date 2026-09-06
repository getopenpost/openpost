<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		SocialPreview,
		createPreviewModel,
		platformNames,
		previewCapabilities,
		previewPlatforms,
		supportsPreviewFormat,
		type PreviewCard,
		type PreviewFormat,
		type PreviewMedia,
		type PreviewMediaKind,
		type PreviewPlatform
	} from '@openpost/social-preview';
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

	let selectedPlatform = $state<PreviewPlatform>('x');
	let selectedFormat = $state<PreviewFormat>('post');
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
	let formatTitle = $state('Your video title');
	let mediaError = $state('');
	let localMediaInput = $state<HTMLInputElement | null>(null);
	let optionsOpen = $state(false);

	const capability = $derived(previewCapabilities[selectedPlatform]);
	const formatOptions = $derived(capability.formats);
	const allowedMediaKinds = $derived(mediaKindsFor(selectedPlatform, selectedFormat));
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
	const mediaHint = $derived(mediaKindLabel(allowedMediaKinds));
	const activeOptionCount = $derived(
		Number(author !== 'OpenPost' || handle !== 'openpost') +
			Number(pollEnabled) +
			Number(Boolean(contentWarning.trim())) +
			Number(Boolean(linkUrl.trim())) +
			Number(localMedia.length > 0 || Boolean(publicMediaUrl.trim())) +
			Number(Boolean(altText.trim()))
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
		if (pollEnabled && capability.polls) return [];
		if (localMedia.length > 0) {
			return localMedia.map((media) => ({ ...media, alt: altText }));
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
				handle
			},
			segments: previewSegments,
			media: previewMedia,
			poll:
				pollEnabled && capability.polls
					? {
							options: pollOptions
								.split(/\n/u)
								.map((option) => option.trim())
								.filter(Boolean)
								.slice(0, 4),
							durationLabel: '1 day'
						}
					: undefined,
			card:
				linkUrl.trim() && availableCardKinds.includes(cardKind)
					? {
							kind: cardKind,
							title: cardKind === 'quote' ? 'Quoted post' : safeDomain(linkUrl) || 'Shared link',
							domain: safeDomain(linkUrl),
							description: cardKind === 'quote' ? linkUrl.trim() : 'Link card preview'
						}
					: undefined,
			contentWarning:
				capability.contentWarning && contentWarning.trim() ? contentWarning.trim() : undefined,
			title:
				selectedPlatform === 'youtube' || selectedFormat === 'document' ? formatTitle : undefined,
			subtitle: selectedPlatform === 'youtube' ? author : undefined
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
		if (selectedFormat === 'document' && formatTitle === 'Your video title') {
			formatTitle = 'Your document title';
		}
		if (
			(selectedFormat === 'video' || selectedFormat === 'short') &&
			formatTitle === 'Your document title'
		) {
			formatTitle = 'Your video title';
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
		if (kinds.some((kind) => kind === 'video' || kind === 'document') && files.length > 1) {
			mediaError = 'Choose one video or document, or up to four images.';
			input.value = '';
			return;
		}
		clearLocalMedia();
		localMedia = files.slice(0, 4).map((file, index) => ({
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
		for (const media of localMedia) {
			if (!allowed.includes(media.kind)) URL.revokeObjectURL(media.src);
		}
		localMedia = localMedia.filter((media) => allowed.includes(media.kind));
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
					: 'up to four images'
		);
		if (labels.length === 0) return 'no media';
		if (labels.length === 1) return labels[0];
		return `${labels.slice(0, -1).join(', ')}, or ${labels.at(-1)}`;
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
		</section>

		{#if capability.polls}
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
						Poll options
						<Textarea
							id="preview-poll"
							bind:value={pollOptions}
							class="min-h-24 p-3 leading-6"
							placeholder="One option per line"
						/>
					</label>
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
				{/if}
			</section>
		{/if}

		<section class="grid gap-4 border-t pt-5" aria-labelledby="preview-media-options">
			<div>
				<h3 id="preview-media-options" class="text-sm font-semibold">Media</h3>
				<p class="mt-1 text-xs leading-5 text-muted-foreground">
					This {selectedFormat.replace('_', ' ')} accepts {mediaHint}.
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
				{#if mediaError}<p class="mt-2 text-sm text-destructive">
						{mediaError}
					</p>{/if}
				{#if localMedia.length > 0}
					<ul class="mt-2 grid gap-1">
						{#each localMedia as media (media.id)}
							<li
								class="flex min-h-11 items-center justify-between gap-3 rounded-md bg-muted px-3 text-xs"
							>
								<span class="truncate">{media.name}</span>
								<button
									type="button"
									class="focus-ring grid size-10 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-foreground"
									aria-label={`Remove ${media.name}`}
									onclick={() => removeMedia(media.id)}
								>
									<Trash2 class="size-4" />
								</button>
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

<div class="mt-8 grid items-start gap-5 xl:grid-cols-[24rem_minmax(0,1fr)]">
	<section class="rounded-xl border bg-card p-4 sm:p-6" aria-labelledby="preview-controls-title">
		<h2 id="preview-controls-title" class="text-lg font-semibold">Build the platform version</h2>
		<p class="mt-1 text-sm leading-6 text-muted-foreground">
			Controls appear only when the selected platform supports them.
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

			{#if selectedPlatform === 'youtube' || selectedFormat === 'document'}
				<label class="grid gap-2 text-sm font-medium" for="preview-title">
					{selectedFormat === 'document' ? 'Document title' : 'Video title'}
					<Input id="preview-title" bind:value={formatTitle} class="h-11" />
				</label>
			{/if}

			<label class="grid gap-2 text-sm font-medium" for="preview-copy">
				Post copy
				<Textarea
					id="preview-copy"
					bind:value={draft}
					class="min-h-36 p-3 leading-6"
					placeholder="Write the post you want to preview..."
				/>
			</label>
			{#if selectedFormat === 'thread'}
				<p class="text-xs leading-5 text-muted-foreground">
					Put <strong>---</strong> on its own line between posts.
				</p>
			{/if}

			<div class="border-t pt-4">
				<Button
					type="button"
					variant="outline"
					class="h-auto min-h-11 w-full justify-between gap-3 px-3 py-2.5 text-left md:h-auto"
					onclick={() => (optionsOpen = true)}
				>
					<span class="flex min-w-0 items-center gap-2.5">
						<SlidersHorizontal class="size-4 shrink-0" />
						<span class="grid min-w-0 gap-0.5">
							<strong class="text-sm">Account, links, polls, and media</strong>
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
		class="grid min-h-[32rem] place-items-center self-start rounded-xl bg-muted/20 p-3 sm:p-6 xl:sticky xl:top-24"
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
			<SocialPreview model={previewModel} />
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
