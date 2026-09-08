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
			description:
				'Record screen, camera, and mic. Cut clips, add captions, and adjust color and sound on a multitrack timeline.',
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
	.composition img {
		position: absolute;
		object-fit: contain;
		height: auto;
		border-radius: 10px;
	}
	.base {
		width: 84%;
		top: 12%;
		left: 8%;
	}
	.image-editor .base {
		top: 16%;
	}
	.image-editor .detail {
		width: 42%;
		right: 8%;
		bottom: 12%;
	}
	.video-editor .base {
		width: 80%;
		left: 10%;
	}
	.video-editor .detail {
		width: 84%;
		left: 8%;
		bottom: 12%;
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
	@media (max-width: 760px) {
		.product-details {
			padding-block: 48px;
		}
		.section-heading {
			display: grid;
			gap: 20px;
		}
		.editors {
			grid-template-columns: minmax(0, 1fr);
			gap: 36px;
		}
		h4 {
			font-size: 24px;
		}
	}
</style>
