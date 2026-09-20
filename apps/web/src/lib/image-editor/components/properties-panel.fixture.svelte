<script lang="ts">
	import { untrack } from 'svelte';
	import { provideImageEditor, type ImageEditorController } from '../editor.svelte';
	import PropertiesPanel from './properties-panel.svelte';

	let {
		editor,
		colorWorkspace = false
	}: { editor: ImageEditorController; colorWorkspace?: boolean } = $props();
	provideImageEditor(untrack(() => editor));
</script>

<div class="h-[800px] w-80 bg-background text-foreground">
	<PropertiesPanel {colorWorkspace} />
</div>
