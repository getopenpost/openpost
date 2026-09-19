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

<Button
	type="button"
	size="sm"
	class="h-[22px]"
	variant={isItalic ? 'secondary' : 'ghost'}
	aria-pressed={isItalic}
	onclick={ontoggleitalic}
>
	{m.video_editor_text_italic()}
</Button>
<Button
	type="button"
	size="sm"
	class="h-[22px]"
	variant={isUnderline ? 'secondary' : 'ghost'}
	aria-pressed={isUnderline}
	onclick={ontoggleunderline}
>
	{m.video_editor_text_underline()}
</Button>
