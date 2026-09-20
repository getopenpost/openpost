<script lang="ts">
	import { untrack } from 'svelte';
	import { provideImageEditor, type ImageEditorController } from '../editor.svelte';
	import ImageEditorResizeDialog from './image-editor-resize-dialog.svelte';

	let { editor }: { editor: ImageEditorController } = $props();
	let open = $state(true);
	provideImageEditor(untrack(() => editor));
</script>

<ImageEditorResizeDialog bind:open />
