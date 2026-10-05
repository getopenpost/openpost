<script lang="ts">
	import type { PreviewModel, PreviewEditing } from '@openpost/social-preview';

	import { m } from '$lib/paraglide/messages';

	let { model, editor }: { model: PreviewModel; editor?: PreviewEditing } = $props();
</script>

<section
	class="min-w-0 py-3"
	aria-label={m.compose_preview()}
	data-testid="composer-account-preview"
>
	{#await import('@openpost/social-preview')}
		<p class="py-8 text-center text-sm text-muted-foreground" role="status">{m.common_loading()}</p>
	{:then module}
		<module.SocialPreview {model} {editor} />
	{:catch}
		<p class="text-sm text-muted-foreground" role="status">{m.preview_load_failed()}</p>
	{/await}
</section>
