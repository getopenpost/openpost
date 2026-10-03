<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import HostedChatPanel from '$lib/editor-agent/hosted-chat-panel.svelte';
	import LocalAiPanel from './local-ai-panel.svelte';
	import type { TextVoiceRequest } from '$lib/video-editor/local-ai/types';
	import type { ProjectAssetImporter } from '$lib/video-editor/media/types';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';

	let {
		projectId,
		sessionId,
		oninserted,
		textVoiceRequest = null,
		importProjectAsset
	}: {
		projectId: string;
		sessionId: string | null;
		oninserted: (itemId: string) => void;
		textVoiceRequest?: TextVoiceRequest | null;
		importProjectAsset?: ProjectAssetImporter;
	} = $props();

	let mode = $state<'assistant' | 'generate'>('assistant');
	let generatePanelMounted = $state(false);
	let handledTextVoiceRequestId = $state<string | null>(null);
	let assistantTab: HTMLButtonElement | undefined = $state(undefined);
	let generateTab: HTMLButtonElement | undefined = $state(undefined);

	$effect(() => {
		if (!textVoiceRequest || textVoiceRequest.id === handledTextVoiceRequestId) return;
		handledTextVoiceRequestId = textVoiceRequest.id;
		mode = 'generate';
	});

	$effect(() => {
		if (mode === 'generate') generatePanelMounted = true;
	});

	function handleSwitcherKeydown(event: KeyboardEvent): void {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		const next = event.key === 'ArrowLeft' || event.key === 'Home' ? 'assistant' : 'generate';
		mode = next;
		queueMicrotask(() => (next === 'assistant' ? assistantTab : generateTab)?.focus());
	}
</script>

<div class="flex h-full min-h-0 flex-col" data-testid="editor-assistant-panel">
	<div class="shrink-0 border-b border-[var(--video-editor-border)] p-2">
		<div
			role="tablist"
			tabindex="-1"
			aria-label={m.video_editor_agent_mode_label()}
			class="grid grid-cols-2 gap-1 rounded-md bg-[var(--video-editor-control)] p-1"
			onkeydown={handleSwitcherKeydown}
		>
			<button
				bind:this={assistantTab}
				role="tab"
				id="assistant-tab"
				aria-selected={mode === 'assistant'}
				aria-controls="assistant-panel"
				tabindex={mode === 'assistant' ? 0 : -1}
				type="button"
				class="min-h-11 rounded px-2 py-1.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--video-editor-focus)] md:min-h-9 {mode ===
				'assistant'
					? 'bg-[var(--video-editor-selection)] text-[var(--video-editor-selection-text)]'
					: 'text-[var(--video-editor-muted)] hover:text-[var(--video-editor-text)]'}"
				onclick={() => (mode = 'assistant')}
			>
				{m.video_editor_agent_assistant()}
			</button>
			<button
				bind:this={generateTab}
				role="tab"
				id="generate-tab"
				aria-selected={mode === 'generate'}
				aria-controls="generate-panel"
				tabindex={mode === 'generate' ? 0 : -1}
				type="button"
				class="min-h-11 rounded px-2 py-1.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--video-editor-focus)] md:min-h-9 {mode ===
				'generate'
					? 'bg-[var(--video-editor-selection)] text-[var(--video-editor-selection-text)]'
					: 'text-[var(--video-editor-muted)] hover:text-[var(--video-editor-text)]'}"
				onclick={() => (mode = 'generate')}
			>
				{m.video_editor_agent_generate()}
			</button>
		</div>
	</div>
	<div class="min-h-0 flex-1 overflow-hidden">
		<div
			role="tabpanel"
			id="assistant-panel"
			aria-labelledby="assistant-tab"
			class="h-full min-h-0"
			hidden={mode !== 'assistant'}
			inert={mode !== 'assistant'}
		>
			<HostedChatPanel
				workspaceId={workspaceCtx.currentWorkspace?.id ?? ''}
				{projectId}
				{sessionId}
			/>
		</div>
		{#if generatePanelMounted}
			<div
				role="tabpanel"
				id="generate-panel"
				aria-labelledby="generate-tab"
				class="h-full min-h-0 overflow-y-auto"
				hidden={mode !== 'generate'}
				inert={mode !== 'generate'}
			>
				<LocalAiPanel {projectId} {oninserted} {textVoiceRequest} {importProjectAsset} />
			</div>
		{/if}
	</div>
</div>
