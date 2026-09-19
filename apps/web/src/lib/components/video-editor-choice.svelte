<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	let { onfull, quickHref = '/quick-cut' }: { onfull: () => void; quickHref?: string } = $props();
</script>

<section class="w-full max-w-xl" aria-labelledby="video-editor-choice-heading">
	<h1 id="video-editor-choice-heading" class="text-xl font-semibold">
		{m.video_editor_quick_choice()}
	</h1>
	<p class="mt-3 text-sm leading-relaxed text-muted-foreground">
		{m.video_editor_quick_choice_hint()}
	</p>
	<div class="mt-6 flex flex-col gap-3 sm:flex-row">
		<Button href={quickHref} variant="outline" class="min-h-11"
			>{m.video_editor_quick_choice_action()}</Button
		>
		<Button onclick={onfull} class="min-h-11">{m.video_editor_full_choice()}</Button>
	</div>
</section>
