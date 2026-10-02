<script lang="ts">
	/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion -- These fetches target Huma-generated responses from OpenPost's own authenticated editor assistant endpoints. */
	import { onDestroy } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import AppSelect from '$lib/components/app-select.svelte';
	import PreferencesPanel from './preferences-panel.svelte';
	import { client } from '$lib/api/client';
	import { toast } from 'svelte-sonner';
	import {
		queryEditorPreferences,
		removeEditorPreference,
		type EditorPreference,
		type EditorPreferences,
		type EditorStyle,
		saveEditorPreference
	} from './preferences';
	import { queryClient } from '$lib/query/client';
	import { editorPreferencesQueryKeys } from '@openpost/query-catalog';

	let {
		workspaceId,
		projectId,
		sessionId,
		kind = 'video'
	}: {
		workspaceId: string;
		projectId: string;
		sessionId: string | null;
		kind?: 'video' | 'image';
	} = $props();

	interface ChatMessage {
		role: 'user' | 'assistant';
		content: string;
		preferences?: Array<{
			saved: EditorPreference;
			previous?: EditorPreference;
			deleted?: boolean;
		}>;
	}

	let available = $state<boolean | null>(null);
	let unavailableReason = $state('');
	let messages = $state<ChatMessage[]>([]);
	let input = $state('');
	let busy = $state(false);
	let status = $state('');
	let preferences = $state<EditorPreferences | null>(null);
	let styleChoice = $state('match');
	let pinnedStyle = $state<EditorStyle | null>(null);
	let preferencesOpen = $state(false);
	let preferencesRevision = $state(0);
	let undoneRules = $state<string[]>([]);
	const builtinLabels = $derived<Record<string, string>>({
		'builtin:clean-demo': m.editor_agent_clean_demo(),
		'builtin:talking-head': m.editor_agent_talking_head(),
		'builtin:fast-short': m.editor_agent_fast_short(),
		'builtin:calm-explainer': m.editor_agent_calm_explainer(),
		'builtin:announcement': m.editor_agent_announcement()
	});
	const visibleStyles = $derived(
		pinnedStyle &&
			!(preferences?.styles ?? []).some(
				(style) => style.id === pinnedStyle?.id && style.version === pinnedStyle?.version
			)
			? [...(preferences?.styles ?? []), pinnedStyle]
			: (preferences?.styles ?? [])
	);
	const styleOptions = $derived([
		{ value: 'match', label: m.editor_agent_match() },
		{ value: 'auto', label: m.editor_agent_auto() },
		...visibleStyles.map((style) => ({
			value: `${style.id}@${style.version}`,
			label: builtinLabels[style.id!] ?? `${style.name} (v${style.version})`
		}))
	]);
	$effect(() => {
		const workspace = workspaceId,
			project = projectId,
			editorKind = kind;
		let active = true;
		if (workspace)
			void queryEditorPreferences(workspace, project, editorKind, '*')
				.then((result) => {
					if (active) preferences = result;
				})
				.catch((error) => {
					if (active) status = error instanceof Error ? error.message : String(error);
				});
		return () => {
			active = false;
		};
	});
	async function undoRule(rule: EditorPreference, previous?: EditorPreference, deleted = false) {
		try {
			if (deleted) await saveEditorPreference(workspaceId, rule);
			else if (previous) await saveEditorPreference(workspaceId, previous, rule.revision);
			else await removeEditorPreference(workspaceId, rule);
			undoneRules = [...undoneRules, rule.id!];
			preferencesRevision++;
		} catch (error) {
			toast.error(error instanceof Error ? error.message : String(error));
		}
	}
	/* oxlint-disable anti-slop/no-runtime-typeof -- Assistant steps cross the HTTP boundary as raw tool JSON. Validate the receipt before offering a rule undo action. */
	function savedRules(
		steps: Array<{ operation: string; result: unknown }>
	): Array<{ saved: EditorPreference; previous?: EditorPreference; deleted?: boolean }> {
		return steps
			.filter(
				(step) => step.operation === 'preferences_set' || step.operation === 'preferences_remove'
			)
			.flatMap((step) => {
				if (!step.result || typeof step.result !== 'object' || !('result' in step.result))
					return [];
				const receipt = step.result.result;
				if (!receipt || typeof receipt !== 'object') return [];
				const deleted = step.operation === 'preferences_remove';
				const record =
					deleted && 'previous' in receipt
						? receipt.previous
						: 'saved' in receipt
							? receipt.saved
							: null;
				if (
					!record ||
					typeof record !== 'object' ||
					!('id' in record) ||
					!('revision' in record) ||
					!('rule' in record) ||
					typeof record.id !== 'string' ||
					typeof record.revision !== 'number'
				)
					return [];
				// SAFETY: This is the typed preference record returned by the authenticated preferences_set operation.
				return [
					{
						saved: record as EditorPreference,
						deleted,
						previous:
							'previous' in receipt && receipt.previous
								? (receipt.previous as EditorPreference)
								: undefined
					}
				];
			});
	}

	/* oxlint-enable anti-slop/no-runtime-typeof */
	let requestAbort: AbortController | null = null;
	onDestroy(() => requestAbort?.abort());
	let conversationProject = '';
	$effect(() => {
		const key = `${workspaceId}:${projectId}`;
		if (conversationProject === key) return;
		conversationProject = key;
		requestAbort?.abort();
		messages = [];
		input = '';
		status = '';
		pinnedStyle = null;
		styleChoice = 'match';
		undoneRules = [];
		preferencesOpen = false;
		preferences = null;
	});

	$effect(() => {
		const workspace = workspaceId;
		if (!workspace) return;
		const controller = new AbortController();
		void (async () => {
			try {
				const { data: result, error } = await client.GET('/editor-agent/assistant/status', {
					params: { query: { workspace_id: workspace } },
					signal: controller.signal
				});
				if (error || !result) throw new Error(error?.detail || m.editor_agent_unavailable());
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
		const history = messages.slice(-10).map(({ role, content }) => ({ role, content }));
		messages = [...messages, { role: 'user', content: prompt }];
		input = '';
		busy = true;
		status = m.video_editor_agent_running();
		const controller = new AbortController();
		const projectKey = conversationProject;
		requestAbort = controller;
		try {
			const selectedStyle = pinnedStyle;
			const { data: result, error } = await client.POST('/editor-agent/assistant', {
				body: {
					workspace_id: workspaceId,
					project_id: projectId,
					session_id: sessionId,
					prompt,
					history,
					style_id: selectedStyle?.id ?? styleChoice,
					style_version: selectedStyle?.version ?? 0
				},
				signal: controller.signal
			});
			if (projectKey !== conversationProject) return;
			if (error || !result) throw new Error(error?.detail || m.editor_agent_unavailable());
			messages = [
				...messages,
				{ role: 'assistant', content: result.reply, preferences: savedRules(result.steps ?? []) }
			];
			await queryClient.invalidateQueries({
				queryKey: editorPreferencesQueryKeys.workspace(workspaceId)
			});
			preferences = await queryEditorPreferences(workspaceId, projectId, kind, '*');
			preferencesRevision++;
			status = (result.steps ?? []).length
				? m.editor_agent_steps_completed({ count: (result.steps ?? []).length })
				: '';
		} catch (error) {
			if (projectKey !== conversationProject) return;
			status = controller.signal.aborted
				? m.editor_agent_stopped()
				: error instanceof Error
					? error.message
					: m.editor_agent_unavailable();
		} finally {
			if (requestAbort === controller) {
				busy = false;
				requestAbort = null;
			}
		}
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter' || event.shiftKey) return;
		event.preventDefault();
		void send();
	}
</script>

<div class="flex h-full min-h-0 flex-col" data-testid="hosted-editor-chat-panel">
	<div class="shrink-0 border-b border-border p-3">
		<div class="flex min-w-0 items-center gap-2">
			<AppSelect
				value={styleChoice}
				options={styleOptions}
				ariaLabel={m.editor_agent_style()}
				onValueChange={(value) => {
					styleChoice = value;
					pinnedStyle =
						(preferences?.styles ?? []).find((style) => `${style.id}@${style.version}` === value) ??
						null;
				}}
				disabled={busy}
				class="min-w-0 flex-1"
			/>
			<Button
				variant="ghost"
				size="sm"
				aria-expanded={preferencesOpen}
				onclick={() => (preferencesOpen = !preferencesOpen)}>{m.editor_agent_preferences()}</Button
			>
		</div>
		<p class="mt-1 text-xs text-muted-foreground">{m.editor_agent_style_help()}</p>
	</div>
	{#if preferencesOpen}<div class="max-h-[45%] shrink-0 overflow-y-auto">
			<PreferencesPanel
				{workspaceId}
				{projectId}
				{kind}
				revision={preferencesRevision}
				onchange={(data) => {
					preferences = data;
					if (pinnedStyle && !data.styles?.some((style) => style.id === pinnedStyle?.id)) {
						pinnedStyle = null;
						styleChoice = 'match';
					}
				}}
			/>
		</div>{/if}
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
			{#each message.preferences ?? [] as receipt (receipt.saved.id)}
				{@const rule = receipt.saved}
				<div class="flex items-center justify-between gap-2 text-xs text-muted-foreground">
					<span class="min-w-0 break-words">{rule.rule}</span>
					<Button
						size="sm"
						variant="ghost"
						disabled={undoneRules.includes(rule.id!)}
						onclick={() => void undoRule(rule, receipt.previous, receipt.deleted)}
						>{m.video_editor_undo()}</Button
					>
				</div>
			{/each}
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
