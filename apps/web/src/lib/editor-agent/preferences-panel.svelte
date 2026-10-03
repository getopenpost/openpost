<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { toast } from 'svelte-sonner';
	import {
		queryEditorPreferences,
		saveEditorPreference,
		removeEditorPreference,
		setEditorLearning,
		archiveEditorStyle,
		type EditorPreferences,
		type EditorPreference
	} from './preferences';
	let {
		workspaceId,
		projectId,
		kind = 'video',
		revision = 0,
		onchange
	}: {
		workspaceId: string;
		projectId: string;
		kind?: 'video' | 'image';
		revision?: number;
		onchange?: (preferences: EditorPreferences) => void;
	} = $props();
	let data = $state<EditorPreferences | null>(null);
	let error = $state('');
	let busy = $state(false);
	let editingId = $state('');
	let draft = $state('');
	let generation = 0;
	async function refresh() {
		const current = ++generation;
		try {
			const result = await queryEditorPreferences(workspaceId, projectId, kind, '*');
			if (current === generation) {
				data = result;
				onchange?.(result);
				error = '';
			}
		} catch (cause) {
			if (current === generation) error = cause instanceof Error ? cause.message : String(cause);
		}
	}
	$effect(() => {
		void revision;
		void refresh();
		return () => {
			generation++;
		};
	});
	async function change(action: () => Promise<void>, undo?: () => Promise<void>) {
		if (busy) return;
		busy = true;
		try {
			await action();
			await refresh();
			toast.success(
				m.editor_agent_preferences_changed(),
				undo
					? { action: { label: m.video_editor_undo(), onClick: () => void change(undo) } }
					: undefined
			);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
		}
	}
	async function toggle(rule: EditorPreference) {
		let saved: EditorPreference;
		await change(
			async () => {
				saved = await saveEditorPreference(
					workspaceId,
					{ ...rule, enabled: !rule.enabled },
					rule.revision
				);
			},
			async () => {
				await saveEditorPreference(workspaceId, rule, saved.revision);
			}
		);
	}
	async function save(rule: EditorPreference) {
		if (!draft.trim()) return;
		let saved: EditorPreference;
		await change(
			async () => {
				saved = await saveEditorPreference(
					workspaceId,
					{ ...rule, rule: draft.trim(), source_instruction: draft.trim() },
					rule.revision
				);
				editingId = '';
			},
			async () => {
				await saveEditorPreference(workspaceId, rule, saved.revision);
			}
		);
	}
</script>

<div class="space-y-3 border-b border-border p-3 text-xs" data-testid="editor-preferences">
	{#if error}<p role="alert" class="text-destructive">{error}</p>{/if}
	{#if !data}<p>{m.common_loading()}</p>{:else}
		<label class="flex min-h-8 items-center gap-2 [@media(pointer:coarse)]:min-h-11">
			<Checkbox
				checked={data.learning_enabled}
				disabled={busy}
				onCheckedChange={(enabled) =>
					void change(
						() => setEditorLearning(workspaceId, { enabled }),
						() => setEditorLearning(workspaceId, { enabled: !enabled })
					)}
			/>
			<span>{m.editor_agent_learn_choices()}</span>
		</label>
		{#if !(data.preferences ?? []).length}<p class="text-muted-foreground">
				{m.editor_agent_preferences_empty()}
			</p>{/if}
		{#each data.preferences ?? [] as rule (rule.id)}
			<div class="space-y-1 border-t border-border pt-2">
				<label class="flex min-h-8 items-start gap-2 [@media(pointer:coarse)]:min-h-11">
					<Checkbox
						checked={rule.enabled}
						disabled={busy}
						onCheckedChange={() => void toggle(rule)}
					/>
					<span class="min-w-0 break-words">{rule.rule}</span>
				</label>
				<p class="pl-6 text-muted-foreground">
					{rule.project_id ? m.video_editor_transcript_scope_project() : m.settings_personal()}
				</p>
				{#if rule.context}<p class="pl-6 text-muted-foreground">{rule.context}</p>{/if}
				{#if editingId === rule.id}
					<Textarea
						bind:value={draft}
						aria-label={m.editor_agent_remember_placeholder()}
						maxlength={1000}
						rows={2}
					/>
					<Button size="sm" disabled={busy || !draft.trim()} onclick={() => void save(rule)}
						>{m.common_save()}</Button
					>
					<Button size="sm" variant="ghost" onclick={() => (editingId = '')}
						>{m.common_cancel()}</Button
					>
				{:else}
					<div class="flex flex-wrap gap-1 pl-6">
						<Button
							size="sm"
							variant="ghost"
							disabled={busy}
							onclick={() => {
								editingId = rule.id!;
								draft = rule.rule;
							}}>{m.common_edit()}</Button
						>
						<Button
							size="sm"
							variant="ghost"
							disabled={busy}
							onclick={() =>
								void change(
									() => removeEditorPreference(workspaceId, rule),
									async () => {
										await saveEditorPreference(workspaceId, rule);
									}
								)}>{m.common_delete()}</Button
						>
					</div>
				{/if}
			</div>
		{/each}
		{#each (data.styles ?? []).filter((style) => !style.built_in) as style (style.id)}
			<div class="flex min-w-0 items-center justify-between gap-2 border-t border-border pt-2">
				<span class="min-w-0 break-words">{style.name}</span>
				<Button
					size="sm"
					variant="ghost"
					disabled={busy}
					onclick={() =>
						void change(
							() => archiveEditorStyle(workspaceId, style),
							() => archiveEditorStyle(workspaceId, style, false)
						)}>{m.common_delete()}</Button
				>
			</div>
		{/each}
		<div class="flex flex-wrap gap-1 border-t border-border pt-2">
			<Button
				size="sm"
				variant="ghost"
				disabled={busy}
				onclick={() =>
					void change(() =>
						setEditorLearning(workspaceId, {
							enabled: data!.learning_enabled,
							reset: true,
							projectId
						})
					)}>{m.editor_agent_forget_project()}</Button
			>
			<Button
				size="sm"
				variant="ghost"
				disabled={busy}
				onclick={() =>
					void change(() =>
						setEditorLearning(workspaceId, { enabled: data!.learning_enabled, reset: true })
					)}>{m.editor_agent_forget_choices()}</Button
			>
		</div>
	{/if}
</div>
