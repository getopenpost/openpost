<script lang="ts" module>
	function outline(steps: Step[], prefix = ''): { value: string; label: string }[] {
		return steps.flatMap((step, index) => [
			{ value: step.id, label: `${prefix}${index + 1}. ${step.name}` },
			...outline(step.then ?? [], `${prefix}↳ ${m.workflows_yes()}: `),
			...outline(step.else ?? [], `${prefix}↳ ${m.workflows_no()}: `)
		]);
	}
</script>

<script lang="ts">
	import { z } from 'zod';
	import { beforeNavigate, goto } from '$app/navigation';
	import { onMount, untrack } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { createQuery } from '@tanstack/svelte-query';
	import { workflowRunsQueryOptions } from '@openpost/query-catalog';
	import type { SocialAccount } from '@openpost/query-catalog';
	import { workflowQueryAPI } from '$lib/query/workflows';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import {
		saveWorkflow,
		publishWorkflow,
		pauseWorkflow,
		startRun,
		sampleSource,
		type Workflow,
		type Step,
		type Connection
	} from './api';
	import {
		actionCatalog,
		availableReferences,
		editSteps,
		findStep,
		newStep,
		runStateLabel,
		sourceLabel
	} from './catalog';
	import Canvas from './canvas.svelte';
	import SourceFields from './source-fields.svelte';
	import StepFields from './step-fields.svelte';
	import RunInspector from './run-inspector.svelte';
	import Choice from './choice.svelte';
	import PageContainer from '$lib/components/page-container.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';
	import { ThemeIcon } from '$lib/themes/icons';
	import { m } from '$lib/paraglide/messages';
	let {
		initial,
		accounts,
		connections
	}: { initial: Workflow; accounts: SocialAccount[]; connections: Connection[] } = $props();
	const desktop = new MediaQuery('(min-width: 1024px)');
	let record = $state.raw(untrack(() => initial));
	let doc = $state.raw(
		untrack(() => ({
			name: initial.name,
			description: initial.description,
			definition: structuredClone(initial.definition)
		}))
	);
	let saved = $state(untrack(() => JSON.stringify(doc)));
	let selectedID = $state('source'),
		panel = $state<'configure' | 'test' | 'runs'>('configure');
	let mobileView = $state<'configure' | 'canvas'>('configure');
	let error = $state(''),
		saveFailed = $state(false),
		busy = $state(false),
		saving = $state(false);
	let history = $state.raw<string[]>([]),
		future = $state.raw<string[]>([]);
	let sample = $state(
		JSON.stringify(
			{
				title: 'A new release',
				body: 'What changed and why it matters.',
				url: 'https://example.com/update'
			},
			null,
			2
		)
	);
	let selectedRun = $state('');
	let pendingSave: Promise<void> | undefined;
	const canEdit = $derived(workspaceCtx.currentWorkspace?.role !== 'viewer');
	const canAdmin = $derived(workspaceCtx.currentWorkspace?.role === 'admin');
	const dirty = $derived(JSON.stringify(doc) !== saved);
	const step = $derived(findStep(doc.definition.steps ?? [], selectedID));
	const references = $derived(availableReferences(doc.definition.steps ?? [], selectedID));
	const runsQuery = createQuery(() =>
		workflowRunsQueryOptions(workflowQueryAPI, initial.workspace_id, initial.id)
	);
	function change(edit: (next: typeof doc) => void) {
		if (!canEdit) return;
		const next = structuredClone(doc);
		edit(next);
		if (JSON.stringify(next) === JSON.stringify(doc)) return;
		history = [...history.slice(-49), JSON.stringify(doc)];
		future = [];
		doc = next;
	}
	function undo() {
		if (!history.length) return;
		future = [...future, JSON.stringify(doc)];
		doc = JSON.parse(history.at(-1)!);
		history = history.slice(0, -1);
	}
	function redo() {
		if (!future.length) return;
		history = [...history, JSON.stringify(doc)];
		doc = JSON.parse(future.at(-1)!);
		future = future.slice(0, -1);
	}
	function editStep(edit: (value: Step, siblings: Step[], index: number) => void) {
		change((next) => {
			editSteps(next.definition.steps ?? [], selectedID, edit);
		});
	}
	function add(kind: Step['kind'], branch?: 'then' | 'else') {
		const added = newStep(kind);
		change((next) => {
			next.definition.steps ??= [];
			if (branch)
				editSteps(next.definition.steps, selectedID, (parent) => {
					parent[branch] = [...(parent[branch] ?? []), added];
				});
			else if (selectedID !== 'source')
				editSteps(next.definition.steps, selectedID, (_parent, siblings, index) => {
					siblings.splice(index + 1, 0, added);
				});
			else next.definition.steps.push(added);
			const available = availableReferences(next.definition.steps, added.id);
			const previousPost = available
				.filter((item) => item.value.endsWith('.publication_id') || item.value.endsWith('.id'))
				.at(-1)?.value;
			if ((kind === 'approval' || kind === 'schedule') && previousPost) {
				added.inputs = { ...added.inputs, publication_id: { reference: previousPost } };
				if (kind === 'schedule')
					added.inputs.revision = { reference: previousPost.replace(/\.[^.]+$/, '.revision') };
			}
		});
		selectedID = added.id;
		panel = 'configure';
		mobileView = 'configure';
	}
	async function save(): Promise<void> {
		if (!canEdit) return;
		if (pendingSave) {
			await pendingSave;
			if (dirty) return save();
			return;
		}
		if (!dirty) return;
		const snapshot = JSON.stringify(doc);
		saving = true;
		pendingSave = (async () => {
			const next = await saveWorkflow(initial.workspace_id, initial.id, {
				...JSON.parse(snapshot),
				expected_revision: record.revision
			});
			record = next;
			saved = snapshot;
			error = '';
			saveFailed = false;
		})();
		try {
			await pendingSave;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.workflows_operation_failed();
			saveFailed = true;
			throw cause;
		} finally {
			pendingSave = undefined;
			saving = false;
		}
	}
	$effect(() => {
		if (!canEdit || !dirty || !doc.name.trim() || saveFailed) return;
		const snapshot = JSON.stringify(doc);
		const timer = setTimeout(() => {
			if (snapshot === JSON.stringify(doc)) void save().catch(() => {});
		}, 900);
		return () => clearTimeout(timer);
	});
	onMount(() =>
		workspaceCtx.registerWorkspaceSwitchGuard(async () => {
			try {
				await save();
				return !dirty && !busy;
			} catch {
				return false;
			}
		})
	);
	beforeNavigate((navigation) => {
		if (!dirty && !saving && !busy) return;
		navigation.cancel();
		if (!navigation.willUnload && navigation.to && !busy) {
			const target = navigation.to.url;
			void save()
				.then(() => {
					if (!dirty) void goto(target);
				})
				.catch(() => {});
		}
	});
	async function reloadSaved() {
		busy = true;
		try {
			const latest = await workflowQueryAPI.get(
				initial.workspace_id,
				initial.id,
				new AbortController().signal
			);
			record = latest;
			doc = {
				name: latest.name,
				description: latest.description,
				definition: structuredClone(latest.definition)
			};
			saved = JSON.stringify(doc);
			history = [];
			future = [];
			error = '';
			saveFailed = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.workflows_operation_failed();
		} finally {
			busy = false;
		}
	}
	async function action(kind: 'publish' | 'pause' | 'preview' | 'live' | 'sample') {
		busy = true;
		error = '';
		try {
			await save();
			if (kind === 'publish')
				record = await publishWorkflow(initial.workspace_id, initial.id, record.revision);
			else if (kind === 'pause')
				record = await pauseWorkflow(initial.workspace_id, initial.id, record.revision);
			else if (kind === 'sample') {
				const items = await sampleSource(initial.workspace_id, doc.definition.source);
				if (items?.length) sample = JSON.stringify(items[0], null, 2);
				else error = m.workflows_no_source_items();
			} else {
				const parsed = z.record(z.string(), z.json()).safeParse(JSON.parse(sample));
				if (!parsed.success) throw new Error(m.workflows_sample_object());
				const run = await startRun(
					initial.workspace_id,
					initial.id,
					record.revision,
					kind,
					parsed.data
				);
				selectedRun = run.id;
				panel = 'runs';
			}
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.workflows_operation_failed();
		} finally {
			busy = false;
		}
	}
</script>

<PageContainer title={m.workflows_title()} themeIconRole="repeat" contentLayout="fill">
	{#snippet actions()}
		<span class="text-xs text-muted-foreground" aria-live="polite"
			>{saving ? m.workflows_saving() : dirty ? m.workflows_unsaved() : m.workflows_saved()}</span
		>
		<Button
			variant="outline"
			disabled={busy}
			onclick={() => {
				panel = 'test';
				mobileView = 'configure';
			}}>{m.workflows_preview()}</Button
		>
		{#if canAdmin && record.enabled}<Button
				variant="outline"
				disabled={busy}
				onclick={() => action('pause')}>{m.workflows_pause()}</Button
			>{/if}
		<Button
			disabled={!canAdmin || busy || saving || !doc.name.trim()}
			onclick={() => action('publish')}
			>{record.enabled ? m.workflows_publish_changes() : m.workflows_publish()}</Button
		>
	{/snippet}
	{#snippet navigation()}
		<div class="flex flex-wrap items-center gap-2 border-b pb-3">
			<Button variant="ghost" size="sm" href="/workflows"
				><ThemeIcon role="arrow-left" class="size-4" />{m.workflows_back()}</Button
			>
			<span class="text-xs text-muted-foreground"
				>{record.enabled
					? m.workflows_active()
					: record.published_revision
						? m.workflows_paused()
						: m.workflows_draft()}</span
			>
			<div class="ml-auto flex gap-1">
				<Button
					variant="ghost"
					size="icon-sm"
					disabled={!history.length}
					onclick={undo}
					aria-label={m.workflows_undo()}><ThemeIcon role="arrow-left" class="size-4" /></Button
				><Button
					variant="ghost"
					size="icon-sm"
					disabled={!future.length}
					onclick={redo}
					aria-label={m.workflows_redo()}><ThemeIcon role="arrow-right" class="size-4" /></Button
				>
			</div>
		</div>
	{/snippet}
	<div class="flex h-full min-h-0 flex-col">
		{#if error}<div class="py-2">
				<InlineNotice tone="error" message={error}
					>{#snippet actions()}{#if saveFailed}<Button
								variant="outline"
								size="sm"
								disabled={saving}
								onclick={() => {
									error = '';
									void save().catch(() => {});
								}}>{m.workflows_retry_save()}</Button
							>{/if}{/snippet}</InlineNotice
				>{#if saveFailed}<Button variant="ghost" size="sm" disabled={busy} onclick={reloadSaved}
						>{m.workflows_reload_saved()}</Button
					>{/if}
			</div>{/if}
		{#if initial.source_error}<div class="py-2">
				<InlineNotice
					tone="warning"
					message={`${m.workflows_source_error()}: ${initial.source_error}`}
				/>
			</div>{/if}
		<div class="flex gap-2 py-2 lg:hidden">
			<Button
				variant={mobileView === 'configure' ? 'secondary' : 'ghost'}
				size="sm"
				onclick={() => (mobileView = 'configure')}>{m.workflows_show_config()}</Button
			><Button
				variant={mobileView === 'canvas' ? 'secondary' : 'ghost'}
				size="sm"
				onclick={() => (mobileView = 'canvas')}>{m.workflows_show_canvas()}</Button
			>
		</div>
		<div
			class="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-lg border lg:grid-cols-[minmax(0,1fr)_360px]"
		>
			<div class="min-h-0 min-w-0 {mobileView === 'canvas' ? 'block' : 'hidden lg:block'}">
				{#if desktop.current || mobileView === 'canvas'}<Canvas
						definition={doc.definition}
						{selectedID}
						onselect={(id) => {
							selectedID = id;
							panel = 'configure';
							mobileView = 'configure';
						}}
					/>{/if}
			</div>
			<div
				class="min-h-0 min-w-0 overflow-y-auto bg-card lg:border-l {mobileView === 'configure'
					? 'block'
					: 'hidden lg:block'}"
			>
				<div
					class="sticky top-0 z-10 flex gap-1 border-b bg-card p-2"
					aria-label={m.workflows_details()}
				>
					{#each [{ id: 'configure', label: m.workflows_configure() }, { id: 'test', label: m.workflows_preview() }, { id: 'runs', label: m.workflows_runs() }] as tab}<Button
							variant={panel === tab.id ? 'secondary' : 'ghost'}
							size="sm"
							onclick={() => (panel = tab.id as typeof panel)}>{tab.label}</Button
						>{/each}
				</div>
				<div class="space-y-5 p-4">
					{#if panel === 'configure'}
						<div class="space-y-2">
							<Label for="workflow-name">{m.workflows_name()}</Label><Input
								id="workflow-name"
								disabled={!canEdit}
								value={doc.name}
								maxlength={100}
								oninput={(event) => change((next) => (next.name = event.currentTarget.value))}
							/>
						</div>
						<div class="space-y-2">
							<Label for="workflow-outline">{m.workflows_outline()}</Label><Choice
								id="workflow-outline"
								value={selectedID}
								options={[
									{ value: 'source', label: sourceLabel(doc.definition.source.kind) },
									...outline(doc.definition.steps ?? [])
								]}
								onchange={(id) => (selectedID = id)}
							/>
						</div>
						<fieldset disabled={!canEdit} class="min-w-0 space-y-5">
							{#if selectedID === 'source'}<SourceFields
									source={doc.definition.source}
									workspaceID={initial.workspace_id}
									{connections}
									{accounts}
									onchange={(source) => change((next) => (next.definition.source = source))}
								/>
							{:else if step}
								<StepFields
									{step}
									{references}
									{accounts}
									onname={(name) => editStep((value) => (value.name = name))}
									oninput={(key, value) =>
										editStep((target) => {
											target.inputs = { ...target.inputs, [key]: value };
										})}
								/>
								<div class="flex flex-wrap gap-2">
									<Button
										variant="outline"
										size="sm"
										onclick={() =>
											editStep((value, siblings, index) => {
												if (index > 0) {
													siblings.splice(index, 1);
													siblings.splice(index - 1, 0, value);
												}
											})}>{m.workflows_move_up()}</Button
									>
									<Button
										variant="outline"
										size="sm"
										onclick={() =>
											editStep((value, siblings, index) => {
												if (index < siblings.length - 1) {
													siblings.splice(index, 1);
													siblings.splice(index + 1, 0, value);
												}
											})}>{m.workflows_move_down()}</Button
									>
									<Button
										variant="ghost"
										size="sm"
										onclick={() => {
											editStep((_value, siblings, index) => siblings.splice(index, 1));
											selectedID = 'source';
										}}>{m.workflows_remove_step()}</Button
									>
								</div>
							{/if}
							<div class="space-y-2 border-t pt-4">
								<p class="text-sm font-medium">{m.workflows_add_step()}</p>
								<Choice
									value="add"
									options={[
										{
											value: 'add',
											label:
												selectedID === 'source' ? m.workflows_add_step() : m.workflows_add_after()
										},
										...actionCatalog().map((item) => ({ value: item.kind, label: item.label }))
									]}
									label={m.workflows_add_step()}
									onchange={(kind) => {
										if (kind !== 'add') add(kind as Step['kind']);
									}}
								/>
								{#if step?.kind === 'condition'}{#each ['then', 'else'] as branch}<Choice
											value="add"
											label={branch === 'then' ? m.workflows_add_yes() : m.workflows_add_no()}
											options={[
												{
													value: 'add',
													label: branch === 'then' ? m.workflows_add_yes() : m.workflows_add_no()
												},
												...actionCatalog().map((item) => ({ value: item.kind, label: item.label }))
											]}
											onchange={(kind) => {
												if (kind !== 'add') add(kind as Step['kind'], branch as 'then' | 'else');
											}}
										/>{/each}{/if}
								{#if !doc.definition.steps?.length}<p class="text-sm text-muted-foreground">
										{m.workflows_empty_steps_help()}
									</p>{/if}
							</div>
						</fieldset>
					{:else if panel === 'test'}
						<p class="text-sm leading-6 text-muted-foreground">{m.workflows_preview_help()}</p>
						{#if doc.definition.source.kind !== 'manual'}<Button
								variant="outline"
								disabled={busy}
								onclick={() => action('sample')}>{m.workflows_fetch_sample()}</Button
							>
							<p class="text-xs text-muted-foreground">{m.workflows_sample_help()}</p>{/if}
						<div class="space-y-3">
							<p class="text-sm font-medium">{m.workflows_sample()}</p>
							{#each [{ key: 'title', label: m.workflows_sample_title() }, { key: 'body', label: m.workflows_post_text() }, { key: 'url', label: m.workflows_sample_url() }] as field}<div
									class="space-y-2"
								>
									<Label for={`sample-${field.key}`}>{field.label}</Label><Textarea
										id={`sample-${field.key}`}
										rows={field.key === 'body' ? 5 : 2}
										value={String(JSON.parse(sample)[field.key] ?? '')}
										oninput={(event) =>
											(sample = JSON.stringify(
												{ ...JSON.parse(sample), [field.key]: event.currentTarget.value },
												null,
												2
											))}
									/>
								</div>{/each}
						</div>
						<Button disabled={!canEdit || busy || saving} onclick={() => action('preview')}
							>{m.workflows_run_preview()}</Button
						>
						<details class="border-t pt-4">
							<summary
								class="cursor-pointer text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring [@media(pointer:coarse)]:py-3"
								>{m.workflows_live()}</summary
							>
							<p class="my-3 text-sm leading-6 text-muted-foreground">{m.workflows_live_help()}</p>
							<Button
								variant="outline"
								disabled={!canAdmin || busy || saving}
								onclick={() => action('live')}>{m.workflows_run_live()}</Button
							>
						</details>
					{:else}
						{#if selectedRun}<Button variant="ghost" size="sm" onclick={() => (selectedRun = '')}
								><ThemeIcon role="arrow-left" class="size-4" />{m.workflows_runs()}</Button
							><RunInspector workspaceID={initial.workspace_id} runID={selectedRun} />
						{:else if runsQuery.error}<InlineNotice
								tone="error"
								message={String(runsQuery.error)}
							/>
						{:else}{#each runsQuery.data ?? [] as run (run.id)}<button
									type="button"
									class="flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
									onclick={() => (selectedRun = run.id)}
									><span class="text-sm"
										>{runStateLabel(run.state)}<span
											class="mt-1 block text-xs text-muted-foreground"
											>{new Date(run.created_at).toLocaleString()}</span
										></span
									><span class="text-xs text-muted-foreground"
										>{run.mode === 'preview' ? m.workflows_preview() : m.workflows_live()}</span
									></button
								>{/each}{#if !runsQuery.data?.length}<p class="text-sm text-muted-foreground">
									{m.workflows_no_runs_help()}
								</p>{/if}{/if}
					{/if}
				</div>
			</div>
		</div>
	</div>
</PageContainer>
