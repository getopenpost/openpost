<script lang="ts">
	import type { PreviewModel } from '@openpost/social-preview';
	import { Button } from '$lib/components/ui/button';
	import { ThemeIcon } from '$lib/themes/icons';
	import { m } from '$lib/paraglide/messages';

	let { model, onOpenFull }: { model: PreviewModel; onOpenFull: () => void } = $props();
</script>

<section class="min-w-0 border-b py-4" aria-label={m.compose_preview()}>
	<div class="mb-3 flex items-center justify-between gap-3">
		<p class="text-xs text-muted-foreground">{m.preview_live_body()}</p>
		<Button variant="outline" size="sm" class="shrink-0" onclick={onOpenFull}>
			<ThemeIcon role="external-link" class="size-3.5" />
			{m.preview_full_page()}
		</Button>
	</div>
	{#await import('@openpost/social-preview')}
		<p class="py-8 text-center text-sm text-muted-foreground" role="status">{m.common_loading()}</p>
	{:then module}
		<module.SocialPreview {model} compact />
	{:catch}
		<p class="text-sm text-muted-foreground" role="status">{m.preview_load_failed()}</p>
	{/await}
</section>
