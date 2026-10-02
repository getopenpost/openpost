<script lang="ts">
	import { untrack } from 'svelte';
	import { provideImageEditor, type ImageEditorController } from '../editor.svelte';
	import ImageEditorCanvas from './image-editor-canvas.svelte';
	let { editor }: { editor: ImageEditorController } = $props();
	provideImageEditor(untrack(() => editor));
</script>

<div style="width: min(800px, 100vw); height: 600px;"><ImageEditorCanvas /></div>
