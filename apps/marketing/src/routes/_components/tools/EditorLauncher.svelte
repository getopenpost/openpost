<script lang="ts">
	import { captureTelemetryEvent } from '@openpost/telemetry';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import { Button } from '$lib/components/ui/button';
	import { appUrl } from '../../_marketing';
	let { editor }: { editor: 'image' | 'video' } = $props();
	const isVideo = $derived(editor === 'video');
	const url = $derived(
		`${appUrl}/${editor}-editor?utm_source=openpo.st&utm_medium=free-tool&utm_campaign=public-${editor}-editor`
	);
</script>

<div class="editor-launcher">
	<div class="editor-action">
		<h2>{isVideo ? 'Your next video starts here.' : 'What will you make today?'}</h2>
		<p>
			{isVideo
				? 'Import a clip or record something new. Trim it, add captions, and make it yours.'
				: 'Start with a photo, a template, or a blank page. Add your words and make it yours.'}
		</p>
		<Button
			href={url}
			size="lg"
			onclick={() =>
				captureTelemetryEvent('public editor opened', { editor, source: 'marketing_tool' })}
			>{isVideo ? 'Open OpenPost Video Editor' : 'Open the free editor'}<ArrowRight
				data-icon="inline-end"
			/></Button
		><small
			>{isVideo
				? 'Beta. Full editing in desktop Chrome or Edge.'
				: 'No account. No watermark. Works on mobile too.'}</small
		>
	</div>
	<img
		src={isVideo
			? '/assets/screenshots/video-editor-dark.webp'
			: '/assets/screenshots/image-editor-dark.webp'}
		alt={isVideo
			? 'OpenPost Video Editor with a preview and timeline'
			: 'OpenPost Image Editor with editable photos and text'}
		width="2880"
		height="1920"
	/>
</div>

<style>
	.editor-launcher {
		overflow: hidden;
		border-radius: 16px;
		background: var(--marketing-blue);
		color: var(--marketing-blue-ink);
	}
	.editor-action {
		padding: clamp(24px, 4vw, 40px);
	}
	h2 {
		font-size: 26px;
		font-weight: 550;
		letter-spacing: -0.025em;
		line-height: 1.25;
	}
	p {
		margin-block: 16px 24px;
		max-width: 54ch;
		line-height: 1.7;
	}
	small {
		display: block;
		margin-top: 14px;
		font-size: 12px;
		line-height: 1.6;
	}
	img {
		display: block;
		width: calc(100% - 24px);
		height: auto;
		margin-left: 24px;
		border-radius: 10px 0 0 0;
	}
</style>
