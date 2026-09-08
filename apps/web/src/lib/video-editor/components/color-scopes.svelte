<script lang="ts">
	import EditorColorScopes from '$lib/components/editor-color-scopes.svelte';
	import { scopeSamples } from '$lib/video-editor/effects/scope-samples.svelte';
	let { itemId, embedded = false }: { itemId: string | null; embedded?: boolean } = $props();
</script>

<EditorColorScopes {itemId} {embedded} sample={scopeSamples.current} />
