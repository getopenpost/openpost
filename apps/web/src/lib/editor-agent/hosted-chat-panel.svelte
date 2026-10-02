<script lang="ts">
	/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion -- These fetches target Huma-generated responses from OpenPost's own authenticated editor assistant endpoints. */
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';

	let {
		workspaceId,
		projectId,
		sessionId
	}: {
		workspaceId: string;
		projectId: string;
		sessionId: string | null;
	} = $props();

	interface ChatMessage {
		role: 'user' | 'assistant';
		content: string;
	}

	let available = $state<boolean | null>(null);
	let unavailableReason = $state('');
	let messages = $state<ChatMessage[]>([]);
	let input = $state('');
	let busy = $state(false);
	let status = $state('');
	let requestAbort: AbortController | null = null;

	$effect(() => {
		const workspace = workspaceId;
		if (!workspace) return;
		const controller = new AbortController();
		void (async () => {
			try {
				const response = await fetch(
					`/api/v1/editor-agent/assistant/status?workspace_id=${encodeURIComponent(workspace)}`,
					{ credentials: 'include', signal: controller.signal }
				);
				if (!response.ok) throw new Error(`Assistant status failed (${response.status})`);
				const result = (await response.json()) as { available: boolean; reason?: string };
				available = result.available;
				unavailableReason = result.reason ?? '';
			} catch (error) {
				if (controller.signal.aborted) return;
				available = false;
				unavailableReason = error instanceof Error ? error.message : 'unavailable';
			}
		})();
		return () => controller.abort();
	});

	async function send(): Promise<void> {
		const prompt = input.trim();
		if (!prompt || busy || !sessionId || !workspaceId || !available) return;
		const history = messages.slice(-10);
		messages = [...messages, { role: 'user', content: prompt }];
		input = '';
		busy = true;
		status = m.video_editor_agent_running();
		const controller = new AbortController();
		requestAbort = controller;
		try {
			const response = await fetch('/api/v1/editor-agent/assistant', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({
					workspace_id: workspaceId,
					project_id: projectId,
					session_id: sessionId,
					prompt,
					history
				}),
				signal: controller.signal
			});
			if (!response.ok) {
				const failure = (await response.json().catch(() => ({}))) as { detail?: string };
				throw new Error(failure.detail || `Assistant failed (${response.status})`);
			}
			const result = (await response.json()) as {
				reply: string;
				steps: Array<{ operation: string }>;
			};
			messages = [...messages, { role: 'assistant', content: result.reply }];
			status = result.steps.length
				? m.editor_agent_steps_completed({ count: result.steps.length })
				: '';
		} catch (error) {
			status = controller.signal.aborted
				? m.editor_agent_stopped()
				: error instanceof Error
					? error.message
					: m.editor_agent_unavailable();
		} finally {
			busy = false;
			requestAbort = null;
		}
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter' || event.shiftKey) return;
		event.preventDefault();
		void send();
	}
</script>

<div class="flex h-full min-h-0 flex-col" data-testid="hosted-editor-chat-panel">
	<div
		class="min-h-0 flex-1 space-y-3 overflow-y-auto p-3"
		role="log"
		aria-label={m.video_editor_agent_assistant()}
	>
		{#if available === null}
			<p class="text-xs text-muted-foreground">{m.common_loading()}</p>
		{:else if !available}
			<p class="text-xs text-muted-foreground">
				{unavailableReason === 'paid_plan_required'
					? m.editor_agent_paid_plan_required()
					: unavailableReason === 'cloud_only'
						? m.editor_agent_cloud_only()
						: m.editor_agent_unavailable()}
			</p>
		{:else}
			<p class="text-xs text-muted-foreground">{m.editor_agent_hosted_intro()}</p>
			{#if !sessionId}<p class="text-xs text-muted-foreground">
					{m.editor_agent_connecting()}
				</p>{/if}
		{/if}
		{#each messages as message, index (index)}
			<div class="flex {message.role === 'user' ? 'justify-end' : 'justify-start'}">
				<p
					class="max-w-[85%] rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs break-words whitespace-pre-wrap"
				>
					{message.content}
				</p>
			</div>
		{/each}
		{#if status}<p role="status" class="text-xs text-muted-foreground">{status}</p>{/if}
	</div>
	<div class="shrink-0 border-t border-border p-3">
		<Textarea
			bind:value={input}
			placeholder={m.video_editor_agent_placeholder()}
			aria-label={m.video_editor_agent_placeholder()}
			rows={3}
			disabled={!available || !sessionId || busy}
			onkeydown={handleKeydown}
		/>
		<div class="mt-2 flex justify-end gap-2">
			{#if busy}
				<Button variant="outline" onclick={() => requestAbort?.abort()}>{m.common_cancel()}</Button>
			{:else}
				<Button disabled={!available || !sessionId || !input.trim()} onclick={() => void send()}
					>{m.video_editor_agent_run()}</Button
				>
			{/if}
		</div>
	</div>
</div>
