<script lang="ts">
	import { ditherSurface } from '@openpost/dither';
	import ThemeImage from '../_components/ThemeImage.svelte';
	import type { MarketingGuide } from '@openpost/social-images';
	let { comparison }: { comparison: NonNullable<MarketingGuide['comparison']> } = $props();
</script>

<div
	class="comparison-visual"
	class:images={comparison.category === 'Images'}
	class:video={comparison.category === 'Video'}
	data-dither-panel
	use:ditherSurface
>
	<div class="product">
		<div class="mark openpost">
			<ThemeImage
				lightSrc="/assets/brand/logo.svg"
				darkSrc="/assets/brand/logo-dark.svg"
				alt="OpenPost"
				width={150}
				height={40}
				loading="eager"
			/>
		</div>
		<span>{comparison.category === 'Publishing' ? 'Create & publish' : 'Free browser editor'}</span>
	</div>
	<span class="versus">vs</span>
	<div class="product">
		<div class="mark" class:postiz={comparison.name === 'Postiz'}>
			<img src={comparison.logo} alt={comparison.name} width="150" height="40" />
		</div>
		<span>{comparison.name}</span>
	</div>
</div>

<style>
	.comparison-visual {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: clamp(12px, 3vw, 28px);
		min-height: 200px;
		padding: 28px 20px;
		background: var(--marketing-mint);
		color: var(--marketing-mint-ink);
	}
	.images {
		background: var(--marketing-lilac);
		color: var(--marketing-lilac-ink);
	}
	.video {
		background: var(--marketing-blue);
		color: var(--marketing-blue-ink);
	}
	.product {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		min-width: 0;
		flex: 1;
		max-width: 180px;
	}
	.mark {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 80px;
		padding: 16px;
		background: white;
		border-radius: 12px;
	}
	.mark.postiz {
		background: #1c1c1c;
	}
	.mark :global(img) {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	.mark.openpost {
		background: var(--card);
	}
	.product > span {
		font-size: 12px;
		font-weight: 600;
		text-align: center;
		text-wrap: balance;
	}
	.versus {
		font-size: 14px;
		font-weight: 600;
	}
	@media (max-width: 639px) {
		.mark {
			height: 64px;
			padding: 12px;
		}
		.comparison-visual {
			min-height: 172px;
			padding: 24px 16px;
		}
	}
</style>
