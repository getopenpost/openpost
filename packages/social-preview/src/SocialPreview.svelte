<script lang="ts">
	import type { PreviewCard, PreviewMedia, PreviewModel, PreviewPoll } from './model';
	import { platformNames } from './model';

	interface Props {
		model: PreviewModel;
		class?: string;
		compact?: boolean;
	}

	let { model, class: className = '', compact = false }: Props = $props();
	let carouselIndex = $state(0);
	let revealedWarning = $state<string | null>(null);

	const primarySegment = $derived(model.segments[0] ?? { id: 'primary', text: '' });
	const primaryMedia = $derived(primarySegment.media?.length ? primarySegment.media : model.media);
	const isVertical = $derived(
		model.format === 'story' ||
			model.format === 'reel' ||
			model.format === 'short' ||
			(model.platform === 'tiktok' && (model.format === 'video' || model.format === 'photo'))
	);
	const platformName = $derived(platformNames[model.platform]);
	const handle = $derived(model.identity.handle.replace(/^@/u, ''));
	const initials = $derived(
		model.identity.displayName
			.split(/\s+/u)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase())
			.join('') || 'OP'
	);
	const boundedCarouselIndex = $derived(
		Math.min(carouselIndex, Math.max(0, primaryMedia.length - 1))
	);
	const activeMedia = $derived(primaryMedia[boundedCarouselIndex]);
	const previewLabel = $derived(`${platformName} ${model.format} preview`);
	const contentWarningHidden = $derived(
		Boolean(model.contentWarning && revealedWarning !== model.contentWarning)
	);

	const actionLabels = $derived.by(() => {
		switch (model.platform) {
			case 'instagram':
				return ['Like', 'Comment', 'Send', 'Save'];
			case 'linkedin':
				return ['Like', 'Comment', 'Repost', 'Send'];
			case 'facebook':
				return ['Like', 'Comment', 'Share'];
			case 'youtube':
				return ['Like', 'Share', 'Save'];
			case 'tiktok':
				return ['Like', 'Comment', 'Save', 'Share'];
			case 'discord':
				return ['React', 'Reply', 'More'];
			default:
				return ['Reply', 'Repost', 'Like', 'Share'];
		}
	});

	function choosePreviousMedia() {
		if (primaryMedia.length === 0) return;
		carouselIndex = (boundedCarouselIndex - 1 + primaryMedia.length) % primaryMedia.length;
	}

	function chooseNextMedia() {
		if (primaryMedia.length === 0) return;
		carouselIndex = (boundedCarouselIndex + 1) % primaryMedia.length;
	}
</script>

{#snippet avatar()}
	<span class="avatar" aria-hidden="true">
		{#if model.identity.avatarUrl}
			<img src={model.identity.avatarUrl} alt="" />
		{:else}
			{initials}
		{/if}
	</span>
{/snippet}

{#snippet author(showHandle = true)}
	<span class="author-line">
		<strong>{model.identity.displayName}</strong>
		{#if model.identity.verified}
			<span class="verified" role="img" aria-label="Verified account">✓</span>
		{/if}
		{#if showHandle}
			<span class="handle">@{handle}</span>
		{/if}
	</span>
{/snippet}

{#snippet mediaItem(media: PreviewMedia, classes = '')}
	<div class={['media-item', classes]} style:--media-ratio={media.aspectRatio ?? 16 / 9}>
		{#if media.kind === 'video'}
			<video
				src={media.src}
				poster={media.poster}
				aria-label={media.alt || 'Video preview'}
				controls
				muted
				playsinline
				preload="metadata"
			></video>
			{#if media.durationLabel}
				<span class="duration">{media.durationLabel}</span>
			{/if}
		{:else if media.kind === 'document'}
			<div class="document-preview">
				<span aria-hidden="true">▤</span>
				<strong>{media.alt || 'Document preview'}</strong>
			</div>
		{:else}
			<img src={media.src} alt={media.alt || ''} />
		{/if}
	</div>
{/snippet}

{#snippet carousel(classes = '')}
	{#if !contentWarningHidden && activeMedia}
		<div class={['media-stage', classes]}>
			{@render mediaItem(activeMedia, isVertical ? 'vertical-media' : '')}
			{#if primaryMedia.length > 1}
				<button
					type="button"
					class="carousel-control previous"
					aria-label="Show previous media"
					onclick={choosePreviousMedia}
				>
					‹
				</button>
				<button
					type="button"
					class="carousel-control next"
					aria-label="Show next media"
					onclick={chooseNextMedia}
				>
					›
				</button>
				<span class="carousel-count">
					{boundedCarouselIndex + 1}/{primaryMedia.length}
				</span>
			{/if}
		</div>
	{:else if !contentWarningHidden && (isVertical || model.format === 'video' || model.format === 'photo')}
		<div class={['empty-media', isVertical && 'vertical-media']}>
			<span>{model.format === 'photo' ? 'Photo' : 'Video'} preview</span>
		</div>
	{/if}
{/snippet}

{#snippet card(cardValue: PreviewCard)}
	<div class="attachment-card">
		{#if cardValue.imageUrl}
			<img src={cardValue.imageUrl} alt="" />
		{/if}
		<div>
			{#if cardValue.domain}<span>{cardValue.domain}</span>{/if}
			<strong>{cardValue.title}</strong>
			{#if cardValue.description}<p>{cardValue.description}</p>{/if}
			{#if cardValue.author}
				<small>@{cardValue.author.handle.replace(/^@/u, '')}</small>
			{/if}
		</div>
	</div>
{/snippet}

{#snippet poll(pollValue: PreviewPoll)}
	<div class="poll" aria-label="Poll preview">
		{#each pollValue.options as option, index (`${option}-${index}`)}
			<div class="poll-option">{option || `Option ${index + 1}`}</div>
		{/each}
		<span>
			{pollValue.allowMultiple ? 'Choose one or more' : 'Choose one'}
			{#if pollValue.durationLabel}
				· {pollValue.durationLabel}{/if}
		</span>
	</div>
{/snippet}

{#snippet postContent(text: string, showExtras = true)}
	{#if showExtras && model.contentWarning}
		<div class="content-warning">
			<div>
				<strong>Content warning</strong>
				<span>{model.contentWarning}</span>
			</div>
			<button
				type="button"
				onclick={() =>
					(revealedWarning = contentWarningHidden ? (model.contentWarning ?? null) : null)}
			>
				{contentWarningHidden ? 'Show post' : 'Hide post'}
			</button>
		</div>
	{/if}
	{#if !contentWarningHidden}
		<p class="post-copy">{text || 'Your post will appear here.'}</p>
	{/if}
	{#if showExtras && !contentWarningHidden && model.card}{@render card(model.card)}{/if}
	{#if showExtras && !contentWarningHidden && model.poll}{@render poll(model.poll)}{/if}
{/snippet}

{#snippet actions()}
	<div class="actions" aria-label="Example platform actions">
		{#each actionLabels as label (label)}
			<span><span aria-hidden="true">○</span>{compact ? '' : label}</span>
		{/each}
	</div>
{/snippet}

<article
	class={[
		'social-preview',
		`platform-${model.platform}`,
		`format-${model.format}`,
		compact && 'compact',
		isVertical && 'vertical',
		className
	]}
	aria-label={previewLabel}
>
	<div class="preview-bar">
		<span class="platform-mark" aria-hidden="true">
			{model.platform === 'unsupported'
				? '?'
				: model.platform === 'x'
					? '𝕏'
					: model.platform === 'instagram'
						? '◎'
						: model.platform === 'youtube'
							? '▶'
							: model.platform === 'tiktok'
								? '♪'
								: model.platform.slice(0, 1).toUpperCase()}
		</span>
		<span>{platformName}</span>
		<span class="format-label">{model.format.replace('_', ' ')}</span>
		{#if model.approximate}
			<span class="approximate">Approximate</span>
		{/if}
	</div>

	{#if model.platform === 'unsupported'}
		<div class="unsupported-preview" role="status">
			<strong>Preview unavailable</strong>
			<p>This connected destination does not have a preview renderer yet.</p>
		</div>
	{:else if model.platform === 'instagram' && !isVertical}
		<div class="native-header">
			{@render avatar()}
			<div>
				{@render author(false)}
				{#if model.location}<span class="meta">{model.location}</span>{/if}
			</div>
			<span class="more" aria-hidden="true">•••</span>
		</div>
		{@render carousel('instagram-media')}
		<div class="native-body">
			{@render actions()}
			<div class="instagram-copy">
				<strong>{handle}</strong>
				{@render postContent(primarySegment.text)}
			</div>
		</div>
	{:else if model.platform === 'youtube' && model.format !== 'short'}
		{@render carousel('youtube-media')}
		<div class="youtube-details">
			{@render avatar()}
			<div>
				<h3>{model.title || primarySegment.text || 'Your video title'}</h3>
				<p>
					{model.identity.displayName}
					{#if model.subtitle}
						· {model.subtitle}{/if}
				</p>
			</div>
			<span class="more" aria-hidden="true">•••</span>
		</div>
		{@render actions()}
	{:else if isVertical}
		<div
			class={[
				'vertical-stage',
				model.format === 'story' && 'story-stage',
				(model.format === 'reel' || model.format === 'short') && 'short-stage'
			]}
			aria-label={`${platformName} ${model.format} player`}
		>
			{#if model.format === 'story'}
				<div class="story-header">
					<span class="story-progress" aria-hidden="true"></span>
					<div>
						{@render avatar()}
						<strong>{model.identity.displayName}</strong>
						<span>{model.createdAtLabel}</span>
					</div>
				</div>
			{/if}
			{@render carousel('vertical-player')}
			<div class="vertical-overlay">
				<div>
					<strong>
						{model.platform === 'youtube'
							? model.title || 'Your Short title'
							: model.platform === 'facebook'
								? model.identity.displayName
								: `@${handle}`}
					</strong>
					<p>{primarySegment.text || 'Your caption will appear here.'}</p>
					{#if model.location}<span>⌖ {model.location}</span>{/if}
				</div>
				<div class="vertical-actions" aria-label="Example platform actions">
					{@render avatar()}
					{#each actionLabels.slice(0, 4) as label (label)}
						<span><b aria-hidden="true">○</b>{label}</span>
					{/each}
				</div>
			</div>
		</div>
	{:else if model.platform === 'discord'}
		<div class="discord-message">
			{@render avatar()}
			<div class="discord-content">
				<div>
					{@render author(false)}
					<span class="meta">{model.createdAtLabel}</span>
				</div>
				{@render postContent(primarySegment.text)}
				{@render carousel('discord-media')}
				{@render actions()}
			</div>
		</div>
	{:else if model.format === 'thread' && model.segments.length > 1}
		<div class="thread">
			{#each model.segments as segment, index (segment.id)}
				<section class="thread-segment">
					<div class="thread-identity">
						{@render avatar()}
						{#if index < model.segments.length - 1}
							<span class="thread-line" aria-hidden="true"></span>
						{/if}
					</div>
					<div class="thread-content">
						<div class="native-header compact-header">
							<div>
								{@render author()}
								<span class="meta"> · {model.createdAtLabel}</span>
							</div>
							<span class="more" aria-hidden="true">•••</span>
						</div>
						{@render postContent(segment.text, index === 0)}
						{#if segment.media?.length && !contentWarningHidden}
							{@render mediaItem(segment.media[0])}
						{/if}
						{@render actions()}
					</div>
				</section>
			{/each}
		</div>
	{:else}
		<div class="native-header">
			{@render avatar()}
			<div>
				{@render author()}
				<span class="meta">
					{#if model.visibility}{model.visibility} ·
					{/if}{model.createdAtLabel}
				</span>
			</div>
			<span class="more" aria-hidden="true">•••</span>
		</div>
		<div class="native-body">
			{#if model.platform === 'linkedin' && model.title}
				<h3 class="post-title">{model.title}</h3>
			{/if}
			{@render postContent(primarySegment.text)}
		</div>
		{@render carousel()}
		<div class="native-body action-body">
			{@render actions()}
		</div>
	{/if}
</article>

<style>
	.social-preview {
		--preview-bg: var(--background, #fff);
		--preview-fg: var(--foreground, #171717);
		--preview-muted: var(--muted-foreground, #6b7280);
		--preview-border: var(--border, #e5e7eb);
		--preview-soft: var(--muted, #f3f4f6);
		width: min(100%, 42rem);
		overflow: hidden;
		border: 1px solid var(--preview-border);
		border-radius: 1rem;
		background: var(--preview-bg);
		color: var(--preview-fg);
		font-family: Geist, Inter, ui-sans-serif, system-ui, sans-serif;
	}

	.preview-bar {
		display: flex;
		min-height: 2.75rem;
		align-items: center;
		gap: 0.55rem;
		padding: 0.6rem 0.85rem;
		border-bottom: 1px solid var(--preview-border);
		background: color-mix(in oklch, var(--preview-soft) 58%, transparent);
		color: var(--preview-muted);
		font-size: 0.74rem;
		font-weight: 650;
	}

	.platform-mark {
		display: grid;
		width: 1.35rem;
		height: 1.35rem;
		place-items: center;
		border-radius: 0.35rem;
		background: var(--platform-color, var(--preview-fg));
		color: white;
		font-size: 0.72rem;
	}

	.format-label {
		text-transform: capitalize;
	}

	.approximate {
		margin-left: auto;
		font-weight: 500;
	}

	.native-header {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 0.7rem;
		padding: 0.9rem 1rem 0.7rem;
	}

	.native-header > div {
		display: grid;
		min-width: 0;
		flex: 1;
	}

	.compact-header {
		padding: 0;
	}

	.avatar {
		display: grid;
		width: 2.55rem;
		height: 2.55rem;
		flex: 0 0 auto;
		place-items: center;
		overflow: hidden;
		border-radius: 999px;
		background: color-mix(in oklch, var(--platform-color, #555) 18%, var(--preview-soft));
		color: var(--preview-fg);
		font-size: 0.73rem;
		font-weight: 750;
	}

	.avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.author-line {
		display: inline-flex;
		min-width: 0;
		align-items: baseline;
		gap: 0.3rem;
		font-size: 0.82rem;
	}

	.author-line strong,
	.handle {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.handle,
	.meta {
		color: var(--preview-muted);
		font-size: 0.74rem;
	}

	.verified {
		display: inline-grid;
		width: 0.95rem;
		height: 0.95rem;
		place-items: center;
		border-radius: 999px;
		background: #1688e8;
		color: white;
		font-size: 0.6rem;
	}

	.more {
		color: var(--preview-muted);
		letter-spacing: 0.08em;
	}

	.native-body {
		padding: 0 1rem 0.9rem;
	}

	.post-copy {
		margin: 0;
		color: var(--preview-fg);
		font-size: 0.92rem;
		line-height: 1.52;
		overflow-wrap: anywhere;
		white-space: pre-wrap;
	}

	.post-title,
	.youtube-details h3 {
		margin: 0 0 0.3rem;
		font-size: 1rem;
		line-height: 1.35;
	}

	.media-stage {
		position: relative;
		width: 100%;
	}

	.media-item {
		position: relative;
		overflow: hidden;
		aspect-ratio: var(--media-ratio);
		background: #151515;
	}

	.media-item img,
	.media-item video {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.native-body + .media-stage,
	.discord-content .media-stage {
		margin-top: 0.85rem;
	}

	.native-body + .media-stage {
		border-block: 1px solid var(--preview-border);
	}

	.empty-media {
		display: grid;
		min-height: 16rem;
		place-items: center;
		background: radial-gradient(circle at 50% 35%, rgb(255 255 255 / 8%), transparent 35%), #171717;
		color: #ddd;
		font-size: 0.85rem;
	}

	.vertical-media {
		aspect-ratio: 9 / 16;
		max-height: 42rem;
	}

	.duration,
	.carousel-count {
		position: absolute;
		right: 0.7rem;
		bottom: 0.7rem;
		border-radius: 0.35rem;
		background: rgb(0 0 0 / 72%);
		color: white;
		padding: 0.2rem 0.42rem;
		font-size: 0.7rem;
		font-weight: 650;
	}

	.carousel-control {
		position: absolute;
		top: 50%;
		display: grid;
		width: 2.75rem;
		height: 2.75rem;
		translate: 0 -50%;
		place-items: center;
		border: 0;
		border-radius: 999px;
		background: rgb(0 0 0 / 58%);
		color: white;
		font: inherit;
		font-size: 1.7rem;
		cursor: pointer;
	}

	.carousel-control:focus-visible {
		outline: 2px solid white;
		outline-offset: 2px;
	}

	.carousel-control.previous {
		left: 0.7rem;
	}

	.carousel-control.next {
		right: 0.7rem;
	}

	.carousel-count {
		top: 0.7rem;
		bottom: auto;
	}

	.actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		color: var(--preview-muted);
		font-size: 0.74rem;
	}

	.actions span {
		display: inline-flex;
		min-height: 2.5rem;
		align-items: center;
		gap: 0.35rem;
	}

	.actions span > span {
		font-size: 1rem;
	}

	.action-body {
		padding-top: 0.35rem;
		padding-bottom: 0.35rem;
		border-top: 1px solid var(--preview-border);
	}

	.attachment-card {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		overflow: hidden;
		margin-top: 0.8rem;
		border: 1px solid var(--preview-border);
		border-radius: 0.75rem;
	}

	.attachment-card:has(> img) {
		grid-template-columns: minmax(7rem, 32%) minmax(0, 1fr);
	}

	.attachment-card > img {
		width: 100%;
		height: 100%;
		min-height: 7rem;
		object-fit: cover;
	}

	.attachment-card > div {
		display: grid;
		align-content: center;
		gap: 0.25rem;
		padding: 0.75rem;
	}

	.attachment-card span,
	.attachment-card small,
	.attachment-card p {
		margin: 0;
		color: var(--preview-muted);
		font-size: 0.72rem;
	}

	.attachment-card strong {
		font-size: 0.86rem;
	}

	.poll {
		display: grid;
		gap: 0.5rem;
		margin-top: 0.8rem;
	}

	.poll-option {
		display: flex;
		min-height: 2.5rem;
		align-items: center;
		padding: 0.55rem 0.8rem;
		border: 1px solid var(--platform-color, var(--preview-border));
		border-radius: 999px;
		font-size: 0.8rem;
		font-weight: 650;
	}

	.poll > span {
		color: var(--preview-muted);
		font-size: 0.7rem;
	}

	.content-warning {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.75rem;
		border-radius: 0.7rem;
		background: var(--preview-soft);
	}

	.content-warning > div {
		display: grid;
		gap: 0.15rem;
	}

	.content-warning strong {
		font-size: 0.78rem;
	}

	.content-warning span {
		color: var(--preview-muted);
		font-size: 0.75rem;
	}

	.content-warning button {
		min-height: 2.75rem;
		flex: 0 0 auto;
		border: 0;
		border-radius: 0.55rem;
		background: var(--preview-fg);
		color: var(--preview-bg);
		padding: 0 0.75rem;
		font: inherit;
		font-size: 0.75rem;
		font-weight: 650;
		cursor: pointer;
	}

	.thread {
		padding: 1rem;
	}

	.thread-segment {
		display: grid;
		grid-template-columns: 2.55rem minmax(0, 1fr);
		gap: 0.7rem;
	}

	.thread-segment + .thread-segment {
		padding-top: 0.9rem;
	}

	.thread-identity {
		position: relative;
	}

	.thread-line {
		position: absolute;
		top: 3rem;
		bottom: -0.6rem;
		left: 50%;
		width: 2px;
		translate: -50% 0;
		background: var(--preview-border);
	}

	.thread-content {
		min-width: 0;
		padding-bottom: 0.8rem;
	}

	.thread-content .post-copy {
		margin-top: 0.35rem;
	}

	.thread-content .media-item {
		margin-top: 0.7rem;
		border-radius: 0.75rem;
	}

	.instagram-media .media-item {
		aspect-ratio: 1;
	}

	.instagram-media {
		border-block: 1px solid var(--preview-border);
	}

	.instagram-copy {
		display: flex;
		align-items: baseline;
		gap: 0.35rem;
	}

	.instagram-copy > strong {
		font-size: 0.85rem;
	}

	.instagram-copy .post-copy {
		display: inline;
	}

	.youtube-details {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: 0.75rem;
		padding: 0.9rem 1rem 0.35rem;
	}

	.youtube-details p {
		margin: 0;
		color: var(--preview-muted);
		font-size: 0.75rem;
	}

	.unsupported-preview {
		display: grid;
		min-height: 14rem;
		place-content: center;
		gap: 0.45rem;
		padding: 2rem;
		text-align: center;
	}

	.unsupported-preview p {
		max-width: 28rem;
		margin: 0;
		color: var(--preview-muted);
		font-size: 0.85rem;
		line-height: 1.5;
	}

	.platform-youtube > .actions {
		padding: 0 1rem 0.5rem 4.4rem;
	}

	.vertical-stage {
		position: relative;
		width: min(100%, 25rem);
		margin-inline: auto;
		background: #111;
	}

	.story-header {
		position: absolute;
		z-index: 2;
		top: 0;
		right: 0;
		left: 0;
		display: grid;
		gap: 0.65rem;
		padding: 0.65rem 0.8rem;
		background: linear-gradient(rgb(0 0 0 / 55%), transparent);
		color: white;
		pointer-events: none;
	}

	.story-progress {
		height: 2px;
		border-radius: 999px;
		background: rgb(255 255 255 / 85%);
	}

	.story-header > div {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.75rem;
	}

	.story-header .avatar {
		width: 2rem;
		height: 2rem;
		background: rgb(255 255 255 / 22%);
		color: white;
	}

	.story-header span {
		color: rgb(255 255 255 / 72%);
	}

	.vertical-player .media-item,
	.vertical-player.empty-media {
		width: 100%;
		max-height: 42rem;
		aspect-ratio: 9 / 16;
	}

	.vertical-overlay {
		position: absolute;
		right: 0;
		bottom: 0;
		left: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr) 3.5rem;
		align-items: end;
		gap: 1rem;
		padding: 5rem 0.8rem 1rem;
		background: linear-gradient(transparent, rgb(0 0 0 / 78%));
		color: white;
		pointer-events: none;
	}

	.vertical-overlay p {
		margin: 0.35rem 0 0;
		font-size: 0.84rem;
		line-height: 1.45;
		white-space: pre-wrap;
	}

	.vertical-overlay > div > span {
		display: block;
		margin-top: 0.35rem;
		font-size: 0.72rem;
	}

	.vertical-actions {
		display: grid;
		justify-items: center;
		gap: 0.75rem;
		font-size: 0.62rem;
	}

	.vertical-actions > span {
		display: grid;
		justify-items: center;
		gap: 0.15rem;
	}

	.vertical-actions b {
		font-size: 1.4rem;
	}

	.discord-message {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.75rem;
		padding: 1rem;
		background: #313338;
		color: #f2f3f5;
	}

	.discord-message .avatar {
		background: #5865f2;
		color: white;
	}

	.discord-content {
		min-width: 0;
	}

	.discord-content .handle,
	.discord-content .meta,
	.discord-content .actions {
		color: #b5bac1;
	}

	.discord-content .post-copy {
		margin-top: 0.25rem;
		color: #dbdee1;
	}

	.discord-content .attachment-card {
		border-color: #4e5058;
		background: #2b2d31;
	}

	.document-preview {
		display: grid;
		height: 100%;
		place-items: center;
		align-content: center;
		gap: 0.65rem;
		background: var(--preview-soft);
		color: var(--preview-fg);
	}

	.document-preview span {
		font-size: 2rem;
	}

	.platform-x {
		--platform-color: #111;
	}

	.platform-mastodon {
		--platform-color: #6364ff;
	}

	.platform-bluesky {
		--platform-color: #1689e8;
	}

	.platform-linkedin {
		--platform-color: #0a66c2;
	}

	.platform-threads {
		--platform-color: #111;
	}

	.platform-instagram {
		--platform-color: #c13584;
	}

	.platform-facebook {
		--platform-color: #1877f2;
	}

	.platform-youtube {
		--platform-color: #ff0033;
	}

	.platform-tiktok {
		--platform-color: #111;
	}

	.platform-discord {
		--platform-color: #5865f2;
	}

	.compact .preview-bar {
		min-height: 2.25rem;
		padding-block: 0.4rem;
	}

	.compact .native-header {
		padding-top: 0.65rem;
	}

	@media (max-width: 34rem) {
		.social-preview {
			border-radius: 0.8rem;
		}

		.preview-bar {
			padding-inline: 0.7rem;
		}

		.native-header,
		.native-body {
			padding-inline: 0.8rem;
		}

		.actions {
			gap: 0.35rem;
		}

		.actions > span {
			font-size: 0;
		}

		.actions > span > span {
			font-size: 1rem;
		}

		.attachment-card:has(> img) {
			grid-template-columns: minmax(5rem, 30%) minmax(0, 1fr);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.carousel-control {
			scroll-behavior: auto;
		}
	}
</style>
