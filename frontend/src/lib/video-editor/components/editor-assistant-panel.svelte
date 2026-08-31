<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { onMount } from 'svelte';
	import type { TextVoiceRequest } from '$lib/video-editor/local-ai/types';
	import AgentChatPanel from './agent-chat-panel.svelte';
	import LocalAiPanel from './local-ai-panel.svelte';
	import { agentStore } from '$lib/video-editor/agent/store.svelte';
	import { setClipRefSelectionProvider } from '$lib/video-editor/agent/clip-refs';
	import {
		setAgentSelectionHandler,
		setAgentHandoffHandlers
	} from '$lib/video-editor/agent/tools/definitions';
	import {
		AGENT_EXPECTED_BYTES,
		inspectAgentStorage,
		type AgentStorageStatus
	} from '$lib/video-editor/agent/storage';

	let {
		projectId,
		oninserted,
		onselectitems,
		onopensilence,
		onopenfillers,
		selectedIds = [],
		onautosave,
		textVoiceRequest = null
	}: {
		projectId: string;
		oninserted: (itemId: string) => void;
		onselectitems: (ids: string[]) => void;
		onopensilence: (itemIds: string[]) => void;
		onopenfillers: (itemIds: string[]) => void;
		selectedIds?: string[];
		onautosave: () => void;
		textVoiceRequest?: TextVoiceRequest | null;
	} = $props();

	let mode = $state<'assistant' | 'generate'>('assistant');
	let assistantTab: HTMLButtonElement | undefined = $state(undefined);
	let generateTab: HTMLButtonElement | undefined = $state(undefined);
	let storage = $state<AgentStorageStatus | null>(null);
	let checkingStorage = $state(false);
	let storageCheckFailed = $state(false);
	let handledTextVoiceRequestId = $state<string | null>(null);

	const agentSupported = $derived(agentStore.supported);

	function formatBytes(bytes: number): string {
		if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
		return `${Math.round(bytes / 1_000_000)} MB`;
	}

	async function refreshStorage(): Promise<void> {
		if (!agentSupported) return;
		checkingStorage = true;
		storageCheckFailed = false;
		try {
			storage = await inspectAgentStorage();
		} catch {
			storageCheckFailed = true;
			storage = null;
		} finally {
			checkingStorage = false;
		}
	}

	function handleSwitcherKeydown(event: KeyboardEvent): void {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		const next = event.key === 'ArrowLeft' || event.key === 'Home' ? 'assistant' : 'generate';
		mode = next;
		queueMicrotask(() => (next === 'assistant' ? assistantTab : generateTab)?.focus());
	}

	$effect(() => {
		if (!textVoiceRequest || textVoiceRequest.id === handledTextVoiceRequestId) return;
		handledTextVoiceRequestId = textVoiceRequest.id;
		mode = 'generate';
	});

	$effect(() => {
		const ids = selectedIds;
		setClipRefSelectionProvider(() => ids);
		agentStore.setSelectionProvider(() => ids);
	});

	$effect(() => {
		agentStore.setAutosave(onautosave);
	});

	onMount(() => {
		setAgentSelectionHandler((ids) => onselectitems(ids));
		setAgentHandoffHandlers({
			openSilenceReview: (ids) => onopensilence(ids),
			openFillerReview: (ids) => onopenfillers(ids)
		});
		if (agentSupported) void refreshStorage();
		return () => {
			setClipRefSelectionProvider(null);
			setAgentSelectionHandler(null);
			setAgentHandoffHandlers({});
			agentStore.setSelectionProvider(null);
			agentStore.setAutosave(undefined);
		};
	});

	$effect(() => {
		void mode;
		void agentSupported;
		if (
			mode === 'assistant' &&
			agentSupported &&
			!storage &&
			!checkingStorage &&
			!storageCheckFailed
		) {
			void refreshStorage();
		}
	});
</script>

<div class="flex h-full min-h-0 flex-col" data-testid="editor-assistant-panel">
	<div class="shrink-0 border-b border-[oklch(0.25_0.015_55)] p-2">
		<!-- svelte-ignore a11y_interactive_supports_focus -->
		<div
			role="tablist"
			aria-label={m.video_editor_agent_mode_label()}
			class="grid grid-cols-2 gap-1 rounded-md bg-[oklch(0.18_0.01_55)] p-1"
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
				class="min-h-11 rounded px-2 py-1.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.66_0.14_45)] md:min-h-9 {mode ===
				'assistant'
					? 'bg-[oklch(0.27_0.02_45)] text-white'
					: 'text-[oklch(0.64_0.015_55)] hover:text-white'}"
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
				class="min-h-11 rounded px-2 py-1.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.66_0.14_45)] md:min-h-9 {mode ===
				'generate'
					? 'bg-[oklch(0.27_0.02_45)] text-white'
					: 'text-[oklch(0.64_0.015_55)] hover:text-white'}"
				onclick={() => (mode = 'generate')}
			>
				{m.video_editor_agent_generate()}
			</button>
		</div>
		<p class="mt-1.5 text-[11px] leading-relaxed text-[oklch(0.65_0.015_55)]">
			{#if mode === 'assistant'}
				{m.video_editor_agent_assistant_hint()}
			{:else}
				{m.video_editor_agent_generate_hint()}
			{/if}
		</p>
		{#if mode === 'assistant'}
			{#if !agentSupported}
				<p class="mt-1 text-[11px] text-[oklch(0.82_0.1_25)]">
					{m.video_editor_agent_webgpu_required()}
				</p>
			{:else if checkingStorage}
				<p class="mt-1 text-[11px] text-[oklch(0.65_0.015_55)]">
					{m.video_editor_agent_storage_checking()}
				</p>
			{:else if storageCheckFailed}
				<p class="mt-1 text-[11px] text-[oklch(0.65_0.015_55)]">
					{m.video_editor_agent_storage_unknown({ size: formatBytes(AGENT_EXPECTED_BYTES) })}
				</p>
			{:else if storage}
				{#if !storage.sufficient}
					<p
						class="mt-1 rounded bg-[oklch(0.25_0.06_25)] px-1.5 py-1 text-[11px] text-[oklch(0.82_0.1_25)]"
					>
						{m.video_editor_agent_storage_insufficient({
							need: formatBytes(storage.missingBytes + storage.headroomBytes),
							have: formatBytes(storage.effectiveAvailableBytes ?? storage.availableBytes ?? 0)
						})}
					</p>
				{:else if storage.sizeStatus === 'unknown' && storage.missingBytes > 0}
					<p class="mt-1 text-[11px] text-[oklch(0.65_0.015_55)]">
						{m.video_editor_agent_storage_unknown({ size: formatBytes(storage.expectedBytes) })}
					</p>
				{:else if storage.readyBytes > 0 && storage.missingBytes > 0}
					<p class="mt-1 text-[11px] text-[oklch(0.65_0.015_55)]">
						{m.video_editor_agent_storage_partial({
							ready: formatBytes(storage.readyBytes),
							total: formatBytes(storage.expectedBytes),
							missing: formatBytes(storage.missingBytes)
						})}
					</p>
				{:else if storage.missingBytes > 0}
					<p class="mt-1 text-[11px] text-[oklch(0.65_0.015_55)]">
						{m.video_editor_agent_storage_first_run({ size: formatBytes(storage.expectedBytes) })}
					</p>
				{:else}
					<p class="mt-1 text-[11px] text-[oklch(0.62_0.04_145)]">
						{m.video_editor_agent_storage_ready({ size: formatBytes(storage.readyBytes) })}
					</p>
				{/if}
			{/if}
		{/if}
	</div>

	<div class="min-h-0 flex-1 overflow-hidden">
		{#if mode === 'assistant'}
			<div
				role="tabpanel"
				id="assistant-panel"
				aria-labelledby="assistant-tab"
				class="h-full min-h-0"
			>
				<AgentChatPanel
					{projectId}
					storageSufficient={storage ? storage.sufficient : true}
					storageUnknown={storage ? storage.sizeStatus === 'unknown' : false}
				/>
			</div>
		{:else}
			<div
				role="tabpanel"
				id="generate-panel"
				aria-labelledby="generate-tab"
				class="h-full min-h-0 overflow-y-auto"
			>
				<LocalAiPanel {projectId} {oninserted} {textVoiceRequest} />
			</div>
		{/if}
	</div>
</div>
