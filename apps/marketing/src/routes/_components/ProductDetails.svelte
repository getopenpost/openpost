<script lang="ts">
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	const editors = [
		{
			name: 'Image Editor',
			icon: 'image-editor',
			tone: 'lilac',
			title: 'An image you can keep editing.',
			description:
				'Layers, text, background removal, and color tools. Export one image or a whole carousel.',
			href: '/tools/social-media-image-editor',
			base: '/assets/screenshots/image-canvas-detail.webp',
			detail: '/assets/screenshots/image-controls-detail.webp',
			alt: 'An editable OpenPost design with a tram photo',
			detailAlt: 'The Image Editor tone controls'
		},
		{
			name: 'Video Editor',
			icon: 'video-editor',
			tone: 'blue',
			title: 'A recording, ready to share.',
			description: 'Cut clips, add captions, and adjust color and sound on a multitrack timeline.',
			href: '/tools/social-media-video-editor',
			base: '/assets/screenshots/video-preview-detail.webp',
			detail: '/assets/screenshots/video-timeline-detail.webp',
			alt: 'A video frame in the OpenPost program monitor',
			detailAlt: 'The video timeline with its tracks, clip, and playhead'
		}
	];
</script>

<section id="product" class="product-details marketing-shell" aria-labelledby="studio-title">
	<div class="section-heading">
		<h2 id="studio-title">Make the media<br />right here.</h2>
		<p>Free browser editors. No account needed.<br />Export without watermarks.</p>
	</div>
	<div class="editors">
		{#each editors as editor (editor.icon)}
			<article class="editor">
				<div class="composition {editor.tone} {editor.icon}">
					<img
						class="base"
						src={editor.base}
						alt={editor.alt}
						loading="lazy"
						width="1200"
						height="800"
					/>
					<img
						class="detail"
						src={editor.detail}
						alt={editor.detailAlt}
						loading="lazy"
						width="600"
						height="500"
					/>
				</div>
				<div class="editor-copy">
					<div class="feature-name">
						<img
							src={`/assets/brand/features/${editor.icon}.svg`}
							alt=""
							width="44"
							height="44"
							loading="lazy"
						/>
						<h3>{editor.name}</h3>
						{#if editor.icon === 'video-editor'}<span class="beta">Beta</span>{/if}
					</div>
					<h4>{editor.title}</h4>
					<p>{editor.description}</p>
					<a class="focus-ring" href={editor.href}
						>Open the {editor.name} <ArrowUpRight size={17} /></a
					>
					{#if editor.icon === 'video-editor'}<small
							>Use desktop Chromium for the full editor.</small
						>{/if}
				</div>
			</article>
		{/each}
	</div>
	<div class="publishing" aria-labelledby="schedule-title">
		<div class="publishing-copy">
			<div class="feature-name">
				<img
					src="/assets/brand/features/calendar.svg"
					alt=""
					width="44"
					height="44"
					loading="lazy"
				/><img
					src="/assets/brand/features/analytics.svg"
					alt=""
					width="44"
					height="44"
					loading="lazy"
				/>
			</div>
			<h2 id="schedule-title">Plan the week.<br />See what worked.</h2>
			<p>
				Give each channel its own text, media, and timing. Follow the results your connected
				platforms make available.
			</p>
			<a class="focus-ring" href="/features"
				>Explore publishing and analytics <ArrowUpRight size={17} /></a
			>
		</div>
		<div class="composition mint schedule">
			<img
				class="calendar"
				src="/assets/screenshots/calendar-detail.webp"
				alt="Scheduled publications in the OpenPost calendar"
				width="1800"
				height="1100"
				loading="lazy"
			/>
			<img
				class="chart"
				src="/assets/screenshots/analytics-detail.webp"
				alt="Daily views reported by connected accounts"
				width="1200"
				height="500"
				loading="lazy"
			/>
		</div>
	</div>
</section>

<style>
	.product-details {
		padding-block: 72px;
	}
	.section-heading {
		display: flex;
		justify-content: space-between;
		align-items: end;
		gap: 24px;
		margin-bottom: 36px;
	}
	h2 {
		font-size: clamp(32px, 3.5vw, 48px);
		font-weight: 550;
		line-height: 1.12;
		letter-spacing: -0.035em;
	}
	p {
		font-size: 16px;
		line-height: 1.7;
		color: var(--muted-foreground);
		max-width: 52ch;
	}
	.editors {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 28px;
	}
	.composition {
		position: relative;
		overflow: hidden;
		border-radius: 14px;
		aspect-ratio: 1.45;
		isolation: isolate;
	}
	.lilac {
		background: var(--marketing-lilac);
	}
	.blue {
		background: var(--marketing-blue);
	}
	.mint {
		background: var(--marketing-mint);
	}
	.composition img {
		position: absolute;
		object-fit: contain;
		height: auto;
		border-radius: 8px;
	}
	.base {
		width: 88%;
		top: 8%;
		left: 6%;
	}
	.image-editor .base {
		width: 100%;
		max-width: none;
		height: 76%;
		object-fit: cover;
		top: 12%;
		left: -12%;
	}
	.image-editor .detail {
		width: 42%;
		right: 5%;
		bottom: 6%;
	}

	.video-editor .base {
		width: 84%;
		left: 8%;
		top: 7%;
	}
	.video-editor .detail {
		width: 88%;
		left: 6%;
		bottom: 9%;
		min-height: 17%;
		object-fit: cover;
		object-position: left;
	}
	.editor-copy {
		padding: 24px 4px 0;
	}
	.feature-name {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 18px;
	}
	h3 {
		font-size: 18px;
		font-weight: 550;
	}
	h4 {
		font-size: 26px;
		line-height: 1.25;
		letter-spacing: -0.025em;
		font-weight: 550;
		margin-bottom: 12px;
	}
	a {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		margin-top: 14px;
		border-radius: 4px;
		font-size: 14px;
		font-weight: 550;
		text-decoration: underline;
		text-underline-offset: 5px;
	}
	small {
		display: block;
		color: var(--muted-foreground);
		font-size: 12px;
		margin-top: 4px;
	}
	.beta {
		font-size: 12px;
		color: var(--muted-foreground);
	}
	.publishing {
		display: grid;
		grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
		align-items: center;
		gap: 48px;
		margin-top: 88px;
	}
	.publishing-copy p {
		margin-top: 20px;
	}
	.schedule {
		aspect-ratio: 1.3;
	}
	.calendar {
		width: 95%;
		max-width: none;
		top: 8%;
		left: 16%;
	}
	.chart {
		width: 83%;
		bottom: 8%;
		left: 6%;
	}
	@media (max-width: 760px) {
		.product-details {
			padding-block: 48px;
		}
		.section-heading {
			display: grid;
			gap: 20px;
		}
		.editors,
		.publishing {
			grid-template-columns: minmax(0, 1fr);
			gap: 36px;
		}
		.publishing {
			margin-top: 56px;
		}
		h4 {
			font-size: 24px;
		}
	}
</style>
