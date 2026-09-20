<script lang="ts">
	import { ArrowRight, Scissors } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { appUrl } from '../../_marketing';
</script>

<div class="quick-cut-launcher">
	<Scissors size={32} aria-hidden="true" />
	<h2>Open a video. Keep the parts you need.</h2>
	<p>
		Quick Cut has its own source list and cut ranges. No format preset, captions, or full timeline
		to set up.
	</p>
	<Button
		size="lg"
		href={`${appUrl}/quick-cut?utm_source=openpo.st&utm_medium=free-tool&utm_campaign=quick-cut`}
		>Open Quick Cut <ArrowRight data-icon="inline-end" /></Button
	>
	<small
		>No account or watermark. Supported formats and exact cut points depend on your browser and
		source video.</small
	>
</div>

<style>
	.quick-cut-launcher {
		padding: clamp(24px, 4vw, 40px);
		background: var(--marketing-blue);
		color: var(--marketing-blue-ink);
		border-radius: 16px;
	}
	h2 {
		font-size: 26px;
		font-weight: 600;
		line-height: 1.25;
		letter-spacing: -0.025em;
		margin-top: 20px;
	}
	p {
		max-width: 54ch;
		line-height: 1.7;
		margin-block: 16px 24px;
	}
	small {
		display: block;
		margin-top: 16px;
		line-height: 1.6;
		font-size: 13px;
	}
</style>
