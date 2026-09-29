<script lang="ts">
	import { z } from 'zod';
	import { beforeNavigate, goto } from '$app/navigation';
	import { onMount, untrack } from 'svelte';

	import { createQuery } from '@tanstack/svelte-query';
	import { workflowRunQueryOptions, workflowRunsQueryOptions } from '@openpost/query-catalog';
	import type { SocialAccount } from '@openpost/query-catalog';
	import { workflowQueryAPI } from '$lib/query/workflows';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import {
		saveWorkflow,
		publishWorkflow,
		pauseWorkflow,
		startRun,
		testNode,
		sampleSource,
		type Workflow,
		type Step,
		type Connection,
		type WorkflowData,
		type Run
	} from './api';
	import {
		availableReferences,
		exampleSource,
		editSteps,
		findStep,
		newStep,
		runStateLabel,
		sourceLabel
	} from './catalog';
	import Canvas from './canvas.svelte';
	import { duplicateStep } from './operations';
	import { recipeSteps } from './recipes';
	import SourceFields from './source-fields.svelte';
	import StepFields from './step-fields.svelte';
	import RunInspector from './run-inspector.svelte';
	import NodePicker from './node-picker.svelte';
	import DataView from './data-view.svelte';
	import GraphPreview from './graph-preview.svelte';
	import { workflowIssues } from './validation';
	import type { Port } from './graph';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
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

	type InspectorInputs = WorkflowData & { source: Run['source'] };
	let record = $state.raw(untrack(() => initial));
	let doc = $state.raw(
		untrack(() => ({
			name: initial.name,
			description: initial.description,
			definition: structuredClone(initial.definition)
		}))
	);
	let saved = $state(untrack(() => JSON.stringify(doc)));
	let picker = $state(false),
		inspector = $state(false),
		addPort = $state<Port>('after');
	let dataTab = $state<'input' | 'configure' | 'output'>('configure');
	let selectedID = $state('source'),
		panel = $state<'configure' | 'test' | 'runs'>('configure');
	let error = $state(''),
		saveFailed = $state(false),
		busy = $state(false),
		saving = $state(false);
	let positions = $state.raw<Record<string, { x: number; y: number }>>({});
	let history = $state.raw<string[]>([]),
		future = $state.raw<string[]>([]);
	let sample = $state(
		untrack(() => JSON.stringify(exampleSource(initial.definition.source.kind), null, 2))
	);
	const sourceKind = $derived(doc.definition.source.kind);
	$effect(() => {
		const kind = sourceKind;
		untrack(() => {
			sample = JSON.stringify(exampleSource(kind), null, 2);
		});
	});
	let selectedRun = $state('');
	let canvas = $state<Canvas>();
	let inspectorOrigin: HTMLElement | null = null;
	let testInputs = $state.raw<Record<string, WorkflowData>>({});
	let pendingSave: Promise<void> | undefined;
	const canEdit = $derived(workspaceCtx.currentWorkspace?.role !== 'viewer');
	const canAdmin = $derived(workspaceCtx.currentWorkspace?.role === 'admin');
	const dirty = $derived(JSON.stringify(doc) !== saved);
	const step = $derived(findStep(doc.definition.steps ?? [], selectedID));
	const runQuery = createQuery(() => ({
		...workflowRunQueryOptions(workflowQueryAPI, initial.workspace_id, selectedRun),
		refetchInterval: (query) =>
			selectedRun &&
			['queued', 'running', 'waiting', 'awaiting_approval'].includes(
				query.state.data?.state ?? 'queued'
			)
				? 3000
				: false
	}));
	const inspectedRun = $derived(runQuery.data);
	const inspectedDefinition = $derived(
		panel === 'runs' && inspectedRun ? inspectedRun.definition : doc.definition
	);
	const inspectedStep = $derived(findStep(inspectedDefinition.steps ?? [], selectedID));
	const selectedResult = $derived(
		inspectedRun?.steps?.find((result) => result.step_id === selectedID)
	);
	const inputData = $derived.by(() => {
		let source: Run['source'];
		try {
			source = JSON.parse(sample);
		} catch {
			source = {};
		}
		const upstream = new Set(
			availableReferences(doc.definition.steps ?? [], selectedID).map(
				(reference) => reference.value.split('.')[0]
			)
		);
		const priorInputs = inspectedRun?.mode === 'test' ? testInputs[inspectedRun.id] : undefined;
		const data: InspectorInputs = {
			...Object.fromEntries(Object.entries(priorInputs ?? {}).filter(([id]) => upstream.has(id))),
			source: panel === 'runs' ? (inspectedRun?.source ?? source) : source
		};
		for (const result of inspectedRun?.steps ?? []) {
			if (result.step_id === selectedID) break;
			if (result.state === 'succeeded') data[result.step_id] = result.output;
		}
		return data;
	});
	const issues = $derived(workflowIssues(doc.definition, inputData.source));
	const references = $derived(
		availableReferences(doc.definition.steps ?? [], selectedID, inputData.source)
	);
	const runsQuery = createQuery(() =>
		workflowRunsQueryOptions(workflowQueryAPI, initial.workspace_id, initial.id)
	);
	function snapshot() {
		return JSON.stringify({ doc, positions, selectedID });
	}
	function restore(value: string) {
		const restored = JSON.parse(value);
		doc = restored.doc;
		positions = restored.positions;
		selectedID = restored.selectedID;
		if (selectedID !== 'source' && !findStep(doc.definition.steps ?? [], selectedID)) {
			selectedID = 'source';
			inspector = false;
		}
	}
	function remember(previous: string) {
		history = [...history.slice(-49), previous];
		future = [];
	}
	function change(edit: (next: typeof doc) => void) {
		if (!canEdit) return;
		const previous = snapshot();
		const next = structuredClone(doc);
		edit(next);
		if (JSON.stringify(next) === JSON.stringify(doc)) return;
		remember(previous);
		doc = next;
	}
	function moveNodes(next: typeof positions) {
		if (!canEdit || JSON.stringify(next) === JSON.stringify(positions)) return;
		remember(snapshot());
		positions = next;
	}
	function undo() {
		if (!canEdit || !history.length) return;
		future = [...future, snapshot()];
		restore(history.at(-1)!);
		history = history.slice(0, -1);
	}
	function redo() {
		if (!canEdit || !future.length) return;
		history = [...history, snapshot()];
		restore(future.at(-1)!);
		future = future.slice(0, -1);
	}
	function shortcut(event: KeyboardEvent) {
		if (event.defaultPrevented || event.isComposing || event.altKey || !canEdit || picker) return;
		const target = event.target;
		if (!(target instanceof HTMLElement)) return;
		const overlay = target.closest(
			'[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'
		);
		if (overlay && !overlay.hasAttribute('data-workflow-inspector')) return;
		if (!(event.metaKey || event.ctrlKey)) return;
		const key = event.key.toLowerCase();
		if (key === 's') {
			event.preventDefault();
			void save().catch(() => {});
			return;
		}
		// Text editors own their history, including an empty undo stack.
		if (
			panel !== 'configure' ||
			target.isContentEditable ||
			target.closest('input, textarea, select, [role="textbox"]')
		)
			return;
		if (key === 'z' || key === 'y') {
			event.preventDefault();
			if (key === 'y' || event.shiftKey) redo();
			else undo();
		}
	}
	function editStep(edit: (value: Step, siblings: Step[], index: number) => void) {
		change((next) => {
			editSteps(next.definition.steps ?? [], selectedID, edit);
		});
	}
	function add(kind: Step['kind'], branch?: 'then' | 'else') {
		insertSteps([newStep(kind)], branch);
	}
	function insertSteps(steps: Step[], branch?: 'then' | 'else') {
		const added = steps[0];
		if (!added) return;
		const kind = added.kind;
		change((next) => {
			next.definition.steps ??= [];
			if (branch)
				editSteps(next.definition.steps, selectedID, (parent) => {
					parent[branch] = [...(parent[branch] ?? []), ...steps];
				});
			else if (selectedID !== 'source')
				editSteps(next.definition.steps, selectedID, (_parent, siblings, index) => {
					siblings.splice(index + 1, 0, ...steps);
				});
			else next.definition.steps.unshift(...steps);
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
		picker = false;
		inspector = true;
		panel = 'configure';
	}
	function remove(id: string) {
		change((next) =>
			editSteps(next.definition.steps ?? [], id, (_node, siblings, index) =>
				siblings.splice(index, 1)
			)
		);
		selectedID = 'source';
		inspector = false;
	}
	function duplicate(id: string) {
		change((next) =>
			editSteps(next.definition.steps ?? [], id, (node, siblings, index) => {
				const copied = duplicateStep(node);
				siblings.splice(index + 1, 0, copied);
				selectedID = copied.id;
			})
		);
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
	const canTestNode = $derived(
		step &&
			!['create_draft', 'build_draft', 'approval', 'schedule', 'reply', 'wait', 'metrics'].includes(
				step.kind
			)
	);
	async function executeNode() {
		if (!step) return;
		busy = true;
		error = '';
		try {
			await save();
			const data = inputData;
			const run = await testNode(initial.workspace_id, initial.id, record.revision, step.id, data);
			testInputs = { ...testInputs, [run.id]: data };
			selectedRun = run.id;
			dataTab = 'output';
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
			if ((kind === 'publish' || kind === 'preview' || kind === 'live') && issues.length) {
				inspector = true;
				selectedID = issues[0].node;
				panel = 'configure';
				throw new Error(m.workflows_issues_count({ count: issues.length }));
			}
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
				inspector = false;
				panel = 'runs';
			}
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.workflows_operation_failed();
		} finally {
			busy = false;
		}
	}
</script>

<svelte:window onkeydown={shortcut} />
<div
	class="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground"
	data-workflow-editor
>
	<header
		class="grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b bg-card px-3 py-2 sm:flex sm:flex-wrap"
	>
		<Button variant="ghost" size="icon-sm" href="/workflows" aria-label={m.workflows_back()}
			><ThemeIcon role="arrow-left" class="size-4" /></Button
		>
		<Input
			id="workflow-name"
			aria-label={m.workflows_name()}
			class="h-8 min-w-24 flex-1 border-transparent bg-transparent font-medium shadow-none sm:max-w-72"
			disabled={!canEdit}
			value={doc.name}
			maxlength={100}
			oninput={(event) => change((next) => (next.name = event.currentTarget.value))}
		/>
		{#if !inspector}<span class="shrink-0 text-[11px] text-muted-foreground" aria-live="polite"
				>{saving ? m.workflows_saving() : dirty ? m.workflows_unsaved() : m.workflows_saved()}</span
			>{/if}
		<div class="col-span-3 flex flex-wrap items-center justify-between gap-2 sm:contents">
			<div class="flex items-center gap-1 sm:ml-auto">
				<Button
					variant={panel !== 'runs' ? 'secondary' : 'ghost'}
					size="sm"
					onclick={() => {
						panel = 'configure';
						inspector = false;
					}}>{m.workflows_editor()}</Button
				>
				<Button
					variant={panel === 'runs' ? 'secondary' : 'ghost'}
					size="sm"
					onclick={() => {
						panel = 'runs';
						inspector = false;
					}}>{m.workflows_runs()}</Button
				>
				<Button
					variant="ghost"
					size="icon-sm"
					class="hidden sm:inline-flex"
					disabled={!history.length}
					onclick={undo}
					aria-keyshortcuts="Control+Z Meta+Z"
					aria-label={m.workflows_undo()}><ThemeIcon role="arrow-left" class="size-4" /></Button
				>
				<Button
					variant="ghost"
					size="icon-sm"
					class="hidden sm:inline-flex"
					disabled={!future.length}
					onclick={redo}
					aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
					aria-label={m.workflows_redo()}><ThemeIcon role="arrow-right" class="size-4" /></Button
				>
				<DropdownMenu.Root>
					<DropdownMenu.Trigger
						class="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring sm:hidden [@media(pointer:coarse)]:size-11"
						aria-label={m.image_editor_more_actions()}
					>
						<ThemeIcon role="more-horizontal" class="size-4" />
					</DropdownMenu.Trigger>
					<DropdownMenu.Content>
						<DropdownMenu.Item
							class="[@media(pointer:coarse)]:min-h-11"
							disabled={!history.length}
							onSelect={undo}>{m.workflows_undo()}</DropdownMenu.Item
						>
						<DropdownMenu.Item
							class="[@media(pointer:coarse)]:min-h-11"
							disabled={!future.length}
							onSelect={redo}>{m.workflows_redo()}</DropdownMenu.Item
						>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</div>
			<div class="flex items-center gap-2">
				{#if record.enabled}<Button
						size="sm"
						variant="outline"
						disabled={!canAdmin || busy}
						onclick={() => action('pause')}>{m.workflows_pause()}</Button
					>{/if}
				<Button
					size="sm"
					disabled={!canAdmin || busy || saving || !doc.name.trim()}
					onclick={() => action('publish')}
					>{record.enabled ? m.workflows_publish_changes() : m.workflows_publish()}</Button
				>
			</div>
		</div>
	</header>
	{#if record.source_error}<div class="border-b p-2">
			<InlineNotice tone="error" message={record.source_error} />
		</div>{/if}
	{#if error && !inspector}<div class="border-b p-2">
			<InlineNotice tone="error" message={error}
				>{#snippet actions()}{#if saveFailed}<Button
							size="sm"
							variant="outline"
							onclick={() => void save().catch(() => {})}>{m.workflows_retry_save()}</Button
						><Button size="sm" variant="ghost" onclick={reloadSaved}
							>{m.workflows_reload_saved()}</Button
						>{/if}{/snippet}</InlineNotice
			>
		</div>{/if}
	<main class="relative min-h-0 flex-1">
		<div class="contents" inert={inspector}>
			{#if panel === 'runs'}
				<div class="grid h-full min-h-0 grid-cols-1 md:grid-cols-[280px_minmax(0,1fr)]">
					<aside
						class="min-h-0 overflow-auto border-r bg-card p-3 {selectedRun
							? 'hidden md:block'
							: ''}"
					>
						<h2 class="mb-3 text-sm font-medium">{m.workflows_runs()}</h2>
						{#each runsQuery.data ?? [] as run}<button
								type="button"
								class="mb-2 w-full rounded-lg border p-3 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring {selectedRun ===
								run.id
									? 'border-ring'
									: ''}"
								onclick={() => (selectedRun = run.id)}
								><GraphPreview definition={run.definition} {run} /><span
									class="mt-2 block text-sm font-medium">{runStateLabel(run.state)}</span
								><span class="block text-xs text-muted-foreground"
									>{new Date(run.created_at).toLocaleString()}</span
								></button
							>{/each}{#if !runsQuery.data?.length}<p
								class="text-sm leading-6 text-muted-foreground"
							>
								{m.workflows_no_runs_help()}
							</p>{/if}
					</aside>
					<div class="min-h-0 overflow-auto p-4">
						{#if selectedRun}<Button variant="ghost" size="sm" onclick={() => (selectedRun = '')}
								>{m.workflows_runs()}</Button
							>
							<div class="h-60 overflow-hidden rounded-lg border">
								{#if inspectedRun}<Canvas
										definition={inspectedRun.definition}
										{selectedID}
										run={inspectedRun}
										readonly
										onselect={(id) => {
											selectedID = id;
											inspector = true;
										}}
									/>{/if}
							</div>
							<div class="mt-4">
								<RunInspector workspaceID={initial.workspace_id} runID={selectedRun} />
							</div>{/if}
					</div>
				</div>
			{:else}
				<Canvas
					bind:this={canvas}
					{positions}
					onlayout={moveNodes}
					onduplicate={duplicate}
					onremove={remove}
					definition={doc.definition}
					{issues}
					{selectedID}
					run={inspectedRun}
					readonly={!canEdit}
					onselect={(id) => {
						selectedID = id;
						inspector = true;
						picker = false;
						panel = 'configure';
					}}
					onadd={(id, port) => {
						selectedID = id;
						addPort = port;
						picker = true;
						inspector = false;
					}}
					onconnect={(source, target, port) => {
						if (source === target || target === 'source') return;
						const moving = findStep(doc.definition.steps ?? [], target);
						if (!moving || findStep([moving], source)) return;
						change((next) => {
							let moved: Step | undefined;
							editSteps(next.definition.steps ?? [], target, (step, siblings, index) => {
								moved = step;
								siblings.splice(index, 1);
							});
							if (!moved) return;
							next.definition.steps ??= [];
							if (source === 'source') next.definition.steps.unshift(moved);
							else
								editSteps(next.definition.steps, source, (step, siblings, index) => {
									if (port === 'then' || port === 'else')
										step[port] = [moved!, ...(step[port] ?? [])];
									else siblings.splice(index + 1, 0, moved!);
								});
						});
					}}
				/>
				<div
					class="absolute top-3 left-3 flex max-w-[calc(100%-76px)] flex-wrap items-center gap-2"
				>
					<Button variant="outline" size="sm" onclick={() => canvas?.organize()}
						><ThemeIcon role="repeat" class="size-4" />{m.workflows_organize()}</Button
					>
					{#if issues.length}<Button
							variant="outline"
							size="sm"
							class="text-destructive"
							onclick={() => {
								selectedID = issues[0].node;
								inspector = true;
								panel = 'configure';
							}}
							><ThemeIcon role="feedback" class="size-4" />{m.workflows_needs_attention()} · {issues.length}</Button
						>{/if}
				</div>
				<Button
					class="absolute top-3 right-3"
					variant="outline"
					size="icon"
					disabled={!canEdit}
					aria-label={m.workflows_add_step()}
					onclick={() => {
						picker = true;
						inspector = false;
						addPort = 'after';
					}}><ThemeIcon role="add" class="size-5" /></Button
				>
				<div
					class="absolute right-3 bottom-3 flex items-center gap-2 rounded-lg border bg-card p-2 shadow-sm"
				>
					<Button
						variant="ghost"
						size="sm"
						onclick={() => {
							panel = 'test';
							inspector = true;
						}}>{m.workflows_test_data()}</Button
					><Button size="sm" disabled={busy || saving || !canEdit} onclick={() => action('preview')}
						><ThemeIcon role="eye" class="size-4" />{m.workflows_run_preview()}</Button
					>
				</div>
				{#if !doc.definition.steps?.length}<div
						class="pointer-events-none absolute inset-x-0 bottom-20 text-center text-sm text-muted-foreground"
					>
						{m.workflows_connect_help()}
					</div>{/if}
			{/if}
		</div>
		{#if picker}<NodePicker
				onrecipe={(id) => insertSteps(recipeSteps(id), addPort === 'after' ? undefined : addPort)}
				onclose={() => (picker = false)}
				onadd={(kind) => add(kind, addPort === 'after' ? undefined : addPort)}
				onsource={(kind) => {
					change(
						(next) =>
							(next.definition.source = {
								kind,
								...(kind === 'interval' ? { interval_minutes: 1440 } : {})
							})
					);
					selectedID = 'source';
					picker = false;
					inspector = true;
					panel = 'configure';
				}}
			/>{/if}
		<Dialog.Root bind:open={inspector}>
			<Dialog.Content
				data-workflow-inspector
				showCloseButton={false}
				class="top-auto bottom-0 left-0 flex h-[calc(100dvh-0.75rem)] max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-t-xl rounded-b-none p-0 sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:h-[min(900px,calc(100dvh-3rem))] sm:w-[calc(100vw-3rem)] sm:max-w-[1600px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl"
				onOpenAutoFocus={() => {
					dataTab = panel === 'runs' ? 'output' : 'configure';
					inspectorOrigin =
						document.activeElement instanceof HTMLElement ? document.activeElement : null;
				}}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					(inspectorOrigin?.isConnected
						? inspectorOrigin
						: document.getElementById('workflow-name')
					)?.focus();
				}}
			>
				<Dialog.Description class="sr-only">{m.workflows_details()}</Dialog.Description>
				<header class="flex items-center gap-2 border-b bg-card px-3 py-2 sm:gap-3">
					<Dialog.Title class="sr-only"
						>{panel === 'test'
							? m.workflows_test_data()
							: selectedID === 'source'
								? sourceLabel(inspectedDefinition.source.kind)
								: inspectedStep?.name}</Dialog.Title
					>
					<div class="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center sm:gap-3">
						{#if panel === 'configure' && step && canEdit}
							<Input
								aria-label={m.workflows_step_name()}
								value={step.name}
								maxlength={100}
								class="min-w-0 flex-1 border-transparent bg-transparent px-2 text-sm font-medium shadow-none hover:border-input focus-visible:border-input"
								oninput={(event) => editStep((target) => (target.name = event.currentTarget.value))}
							/>
						{:else}<span class="min-w-0 flex-1 truncate text-sm font-medium"
								>{panel === 'test'
									? m.workflows_test_data()
									: selectedID === 'source'
										? sourceLabel(inspectedDefinition.source.kind)
										: inspectedStep?.name}</span
							>{/if}
						<span class="shrink-0 px-2 text-[11px] text-muted-foreground sm:px-0" aria-live="polite"
							>{saving
								? m.workflows_saving()
								: dirty
									? m.workflows_unsaved()
									: m.workflows_saved()}</span
						>
					</div>
					<Button
						size="sm"
						variant="outline"
						disabled={busy || (canTestNode ? !canAdmin : !canEdit) || panel === 'runs'}
						onclick={() => (canTestNode ? executeNode() : action('preview'))}
						>{canTestNode ? m.workflows_test_node() : m.workflows_run_preview()}</Button
					>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={m.workflows_close_node()}
						onclick={() => (inspector = false)}><ThemeIcon role="close" class="size-4" /></Button
					>
				</header>
				{#if error}<div class="border-b p-3">
						<InlineNotice tone="error" message={error} />
					</div>{/if}
				<div class="flex border-b p-1 lg:hidden">
					{#each ['input', 'configure', 'output'] as tab}<Button
							size="sm"
							variant={dataTab === tab ? 'secondary' : 'ghost'}
							onclick={() => (dataTab = tab as typeof dataTab)}
							>{tab === 'input'
								? m.workflows_input()
								: tab === 'output'
									? m.workflows_output()
									: m.workflows_configure()}</Button
						>{/each}
				</div>
				<div
					class="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)_minmax(0,1fr)]"
				>
					<div
						class="min-h-0 overflow-hidden bg-muted/20 {dataTab === 'input'
							? 'block'
							: 'hidden lg:block'}"
					>
						<DataView
							label={m.workflows_input()}
							value={inputData}
							draggable
							empty={m.workflows_input_help()}
						/>
					</div>
					<div
						class="min-h-0 overflow-y-auto border-x bg-card p-4 {dataTab === 'configure'
							? 'block'
							: 'hidden lg:block'}"
					>
						{#if panel === 'test'}<div class="space-y-4">
								<p class="text-sm leading-6 text-muted-foreground">{m.workflows_preview_help()}</p>
								<Label for="workflow-sample-json">{m.workflows_sample_json()}</Label><Textarea
									id="workflow-sample-json"
									rows={14}
									bind:value={sample}
								/>{#if doc.definition.source.kind !== 'manual'}<Button
										variant="outline"
										disabled={busy}
										onclick={() => action('sample')}>{m.workflows_fetch_sample()}</Button
									>{/if}<Button
									disabled={!canEdit || busy || saving}
									onclick={() => action('preview')}>{m.workflows_run_preview()}</Button
								>
								<details class="border-t pt-4">
									<summary class="cursor-pointer text-sm font-medium">{m.workflows_live()}</summary>
									<p class="my-3 text-sm leading-6 text-muted-foreground">
										{m.workflows_live_help()}
									</p>
									<Button
										variant="outline"
										disabled={!canAdmin || busy || saving}
										onclick={() => action('live')}>{m.workflows_run_live()}</Button
									>
								</details>
							</div>
						{:else if panel === 'runs'}<DataView
								label={m.workflows_configure()}
								value={selectedID === 'source'
									? inspectedRun?.definition.source
									: selectedResult?.inputs}
							/>{:else}<fieldset disabled={!canEdit} class="min-w-0 space-y-5">
								{#if selectedID === 'source'}<SourceFields
										source={doc.definition.source}
										{connections}
										{accounts}
										onchange={(source) => change((next) => (next.definition.source = source))}
									/>
								{:else if step}{#key step.id}
										<StepFields
											workspaceID={initial.workspace_id}
											{step}
											{references}
											readonly={!canEdit}
											data={inputData}
											oninputs={(inputs) =>
												editStep((target) => (target.inputs = { ...target.inputs, ...inputs }))}
											{accounts}
											{connections}
											oninput={(key, value) =>
												editStep((target) => (target.inputs = { ...target.inputs, [key]: value }))}
										/>{/key}
									<div class="flex flex-wrap gap-2 border-t pt-4">
										<Button
											variant="outline"
											size="sm"
											onclick={() => {
												picker = true;
												inspector = false;
												addPort = 'after';
											}}>{m.workflows_add_after()}</Button
										><Button
											variant="ghost"
											size="sm"
											onclick={() => {
												remove(selectedID);
											}}>{m.workflows_remove_step()}</Button
										>
									</div>{/if}
							</fieldset>{/if}
					</div>
					<div
						class="min-h-0 overflow-hidden bg-muted/20 {dataTab === 'output'
							? 'block'
							: 'hidden lg:block'}"
					>
						<DataView
							label={m.workflows_output()}
							value={selectedID === 'source'
								? inputData.source
								: selectedResult?.state === 'running'
									? undefined
									: selectedResult?.output}
							status={selectedResult ? runStateLabel(selectedResult.state) : ''}
							error={selectedResult?.error ?? ''}
						/>
					</div>
				</div>
			</Dialog.Content>
		</Dialog.Root>
	</main>
</div>
