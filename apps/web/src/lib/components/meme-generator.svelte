<script lang="ts">
	import type { ScreenshotDesign } from '@openpost/query-catalog';
	import type {
		MemeGeneratorAPI,
		MemeRenderResult,
		MemeSuggestionCandidate,
		MemeTone
	} from '$lib/meme-generator/types';
	import { memeGeneratorAPI } from '$lib/meme-generator/api';
	import MemeBrowser from '$lib/meme-generator/browser.svelte';
	import Editor from '$lib/screenshot-templates/editor.svelte';
	import { memeDocument } from '$lib/screenshot-templates/meme';
	import { createScreenshotDesign } from '$lib/screenshot-templates/api';
	let {
		workspaceId,
		language = 'en',
		initialIdea = '',
		initialTone = 'balanced',
		initialCandidate,
		initialPreview = '',
		api = memeGeneratorAPI,
		onAttach
	}: {
		workspaceId: string;
		language?: string;
		initialIdea?: string;
		initialTone?: MemeTone;
		initialCandidate?: MemeSuggestionCandidate;
		initialPreview?: string;
		api?: MemeGeneratorAPI;
		onAttach: (result: Pick<MemeRenderResult, 'media'>) => void | boolean | Promise<void | boolean>;
	} = $props();
	let design = $state.raw<ScreenshotDesign>();
	let editor: Editor | undefined = $state();
	export async function flush(): Promise<boolean> {
		return (await editor?.flush()) ?? true;
	}
</script>

{#if design}
	{#key design.id}<Editor
			bind:this={editor}
			{design}
			memeAPI={api}
			onBack={() => (design = undefined)}
			onCopy={(copy) => (design = copy)}
			onAttach={async (media) => (await onAttach({ media })) !== false}
		/>{/key}
{/if}
<div hidden={!!design} class="min-h-0 w-full min-w-0 flex-1 overflow-y-auto">
	<MemeBrowser
		{workspaceId}
		{language}
		{initialIdea}
		{initialTone}
		{initialCandidate}
		{initialPreview}
		{api}
		onSelect={async (template, captions, altText) => {
			design = await createScreenshotDesign(workspaceId, memeDocument(template, captions, altText));
		}}
	/>
</div>
