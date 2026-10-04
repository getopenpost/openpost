<script lang="ts">
	import type { MarketingGuide } from '@openpost/social-images';
	import { ditherSurface } from '@openpost/dither';
	import ComparisonVisual from './ComparisonVisual.svelte';
	import ToolThumbnail from '../tools/ToolThumbnail.svelte';
	let { guide }: { guide: MarketingGuide } = $props();
</script>

{#if guide.comparison}
	<ComparisonVisual comparison={guide.comparison} />
{:else}
	<div
		class="content-visual"
		class:update={guide.thumbnail === 'thread-splitter'}
		class:schedule={guide.thumbnail === 'best-time-to-post-calculator'}
		data-dither-panel
		use:ditherSurface
	>
		<div class="tool-preview">
			<ToolThumbnail slug={guide.thumbnail ?? 'post-preview-generator'} />
		</div>
	</div>
{/if}

<style>
	.content-visual {
		display: grid;
		place-items: center;
		height: 100%;
		background: var(--marketing-mint);
		color: var(--marketing-mint-ink);
	}
	.content-visual.update {
		background: var(--marketing-lilac);
		color: var(--marketing-lilac-ink);
	}
	.content-visual.schedule {
		background: var(--marketing-blue);
		color: var(--marketing-blue-ink);
	}
	.tool-preview {
		width: 70%;
		height: 60%;
		border: 1px solid var(--border);
		border-radius: 12px;
		overflow: hidden;
	}
</style>
