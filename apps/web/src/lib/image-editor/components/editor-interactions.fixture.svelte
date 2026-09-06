<script lang="ts">
	import { untrack } from 'svelte';
	import { provideImageEditor, type ImageEditorController } from '../editor.svelte';
	import LayerTree from './layer-tree.svelte';
	import PageStrip from './page-strip.svelte';
	let { editor }: { editor: ImageEditorController } = $props();
	provideImageEditor(untrack(() => editor));
</script>

<div
	class="bg-background text-foreground"
	style="height: 600px; display: flex; flex-direction: column;"
>
	<div style="height: 380px;"><LayerTree /></div>
	<div style="height: 180px;"><PageStrip /></div>
</div>
