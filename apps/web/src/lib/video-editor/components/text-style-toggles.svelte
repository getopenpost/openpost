<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';

	let {
		isItalic,
		isUnderline,
		ontoggleitalic,
		ontoggleunderline
	}: {
		isItalic: boolean;
		isUnderline: boolean;
		ontoggleitalic: () => void;
		ontoggleunderline: () => void;
	} = $props();
</script>

<div
	class="col-span-2 grid grid-cols-2 overflow-hidden rounded-md border border-[var(--video-editor-border)] bg-[var(--video-editor-control)]"
	role="group"
	aria-label={m.video_editor_text_span_style()}
>
	<Button
		type="button"
		size="sm"
		class="h-[25px] rounded-none border-0 shadow-none"
		variant={isItalic ? 'secondary' : 'ghost'}
		aria-pressed={isItalic}
		onclick={ontoggleitalic}
	>
		{m.video_editor_text_italic()}
	</Button>
	<Button
		type="button"
		size="sm"
		class="h-[25px] rounded-none border-0 border-l border-[var(--video-editor-border)] shadow-none"
		variant={isUnderline ? 'secondary' : 'ghost'}
		aria-pressed={isUnderline}
		onclick={ontoggleunderline}
	>
		{m.video_editor_text_underline()}
	</Button>
</div>
