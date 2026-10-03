<script lang="ts">
	import {
		SvelteFlow,
		Background,
		Controls,
		MarkerType,
		type Node,
		type Edge,
		type OnConnectEnd,
		type Connection
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { mode } from 'mode-watcher';
	import { untrack } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	const narrow = new MediaQuery('(max-width: 639px)');
	import WorkflowNode, { type WorkflowNodeData } from './node.svelte';
	import RevealStep from './reveal-step.svelte';
	import { workflowGraph, connectionWouldLoop, type Port } from './graph';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import type { Definition, Run } from './api';
	import type { Issue } from './validation';
	import { m } from '$lib/paraglide/messages';
	let {
		definition,
		positions = {},
		onlayout,
		selectedID,
		onselect,
		onselection,
		onadd,
		onconnect,
		onduplicate,
		onremove,
		run,
		issues,
		readonly = false
	}: {
		definition: Definition;
		positions?: Record<string, { x: number; y: number }>;
		onlayout?: (positions: Record<string, { x: number; y: number }>) => void;
		selectedID: string;
		onselect: (id: string) => void;
		onselection?: (id: string) => void;
		onadd?: (id: string, port: Port) => void;
		onduplicate?: (id: string) => void;
		onremove?: (id: string) => void;
		onconnect?: (source: string, target: string, port: Port) => void;
		run?: Run;
		issues?: Issue[];
		readonly?: boolean;
	} = $props();
	let layoutVersion = $state(0);
	let canvasElement = $state<HTMLDivElement>();
	let revealID = $state('');
	let previousIDs: Set<string> | undefined;
	let connectionWarning = $state(false);
	export function organize() {
		onlayout?.({});
		layoutVersion++;
	}
	const nodeTypes = { workflow: WorkflowNode };
	const graph = $derived(workflowGraph(definition, run, issues));
	$effect(() => {
		const ids = graph.nodes.map((node) => node.id);
		const selected = selectedID;
		if (!readonly && previousIDs && !previousIDs.has(selected) && ids.includes(selected))
			revealID = selected;
		previousIDs = new Set(ids);
	});
	const projectedNodes = $derived<Node<WorkflowNodeData>[]>(
		graph.nodes.map((node) => ({
			id: node.id,
			type: 'workflow',
			position: positions[node.id] ?? { x: node.x, y: node.y },
			selected: node.id === selectedID,
			data: {
				...node,
				readonly,
				onselect: () => onselect(node.id),
				onduplicate:
					!readonly && !node.source && onduplicate ? () => onduplicate(node.id) : undefined,
				onremove: !readonly && !node.source && onremove ? () => onremove(node.id) : undefined,
				onadd: !readonly && onadd ? (port) => onadd?.(node.id, port) : undefined
			}
		}))
	);
	let nodes = $state.raw<Node<WorkflowNodeData>[]>([]);
	$effect(() => {
		nodes = projectedNodes;
	});
	const edges = $derived<Edge[]>(
		graph.edges.map((edge) => ({
			...edge,
			sourceHandle: edge.port,
			type: 'smoothstep',
			markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--muted-foreground)' },
			style: 'stroke: var(--muted-foreground); stroke-width: 1.5'
		}))
	);
	function outputPort(handle: string | null | undefined): Port {
		return handle === 'then' || handle === 'else' ? handle : 'after';
	}
	function validConnection(connection: Pick<Connection, 'source' | 'target'>) {
		return (
			!readonly &&
			connection.target !== 'source' &&
			!connectionWouldLoop(definition, connection.source, connection.target)
		);
	}
	const connectEnd: OnConnectEnd = (_event, state) => {
		if (readonly) return;
		if (!state.isValid && state.fromHandle && state.toHandle) {
			const source = state.fromHandle.type === 'source' ? state.fromNode?.id : state.toNode?.id;
			const target = state.fromHandle.type === 'target' ? state.fromNode?.id : state.toNode?.id;
			connectionWarning = Boolean(
				source && target && connectionWouldLoop(definition, source, target)
			);
			return;
		}
		if (
			!readonly &&
			!state.isValid &&
			!state.toNode &&
			state.fromNode &&
			state.fromHandle?.type === 'source'
		)
			onadd?.(state.fromNode.id, outputPort(state.fromHandle.id));
	};
	function connect(connection: Connection) {
		if (validConnection(connection))
			onconnect?.(connection.source, connection.target, outputPort(connection.sourceHandle));
	}
</script>

<div
	bind:this={canvasElement}
	class="workflow-canvas relative h-full min-h-0 bg-background"
	aria-label={m.workflows_canvas()}
>
	{#if connectionWarning}
		<div class="absolute top-16 right-3 left-3 z-10 max-w-xl">
			<InlineNotice
				tone="warning"
				message={m.workflows_connection_loop()}
				onDismiss={() => (connectionWarning = false)}
				dismissLabel={m.common_close()}
			/>
		</div>
	{/if}
	{#key layoutVersion}
		<!-- Canvas selection events must not subscribe to the authored selection they update. -->
		<SvelteFlow
			onselectionchange={({ nodes: selected }) =>
				untrack(() => {
					const node = selected[0];
					if (!readonly && node && node.id !== selectedID) onselection?.(node.id);
				})}
			onkeydown={(event) => {
				if (readonly || !event.defaultPrevented || !event.key.startsWith('Arrow')) return;
				const target = event.target;
				if (!(target instanceof HTMLElement) || !target.closest('.svelte-flow__node')) return;
				// SvelteFlow has applied the keyboard nudge before this event bubbles.
				onlayout?.({
					...positions,
					...Object.fromEntries(
						nodes.filter((node) => node.selected).map((node) => [node.id, node.position])
					)
				});
			}}
			onnodedragstop={({ nodes: moved }) => {
				onlayout?.({
					...positions,
					...Object.fromEntries(moved.map((node) => [node.id, node.position]))
				});
			}}
			bind:nodes
			{edges}
			{nodeTypes}
			fitView
			fitViewOptions={{
				padding: 0.25,
				maxZoom: 1,
				nodes: (layoutVersion ? graph.nodes : graph.nodes.slice(0, narrow.current ? 1 : 3)).map(
					({ id }) => ({ id })
				)
			}}
			minZoom={0.15}
			maxZoom={1.75}
			nodesDraggable={!readonly}
			nodesConnectable={!readonly}
			edgesFocusable={false}
			deleteKey={[]}
			isValidConnection={validConnection}
			onconnectstart={() => (connectionWarning = false)}
			onclickconnectstart={() => (connectionWarning = false)}
			onconnectend={connectEnd}
			onclickconnectend={connectEnd}
			onbeforeconnect={(connection) => {
				// The authored document projects edges; XYFlow must not keep an independent edge.
				connect(connection);
				return false;
			}}
			colorMode={mode.current ?? 'light'}
			ariaLabelConfig={{
				'controls.ariaLabel': m.image_editor_zoom(),
				'controls.zoomIn.ariaLabel': m.image_editor_zoom_in(),
				'controls.zoomOut.ariaLabel': m.image_editor_zoom_out(),
				'controls.fitView.ariaLabel': m.image_editor_fit_canvas()
			}}
		>
			<RevealStep
				id={!readonly && selectedID === revealID ? revealID : ''}
				canvas={canvasElement}
				onreveal={(id) => {
					if (revealID === id) revealID = '';
				}}
			/>
			<Background
				gap={24}
				size={1}
				patternColor="color-mix(in oklch, var(--muted-foreground) 30%, transparent)"
			/>
			<Controls
				showLock={false}
				position="bottom-left"
				orientation="horizontal"
				fitViewOptions={{ padding: 0.2 }}
			/>
		</SvelteFlow>
	{/key}
</div>

<style>
	.workflow-canvas {
		--xy-background-color: var(--background);
		--xy-controls-button-background-color: var(--card);
		--xy-controls-button-background-color-hover: var(--accent);
		--xy-controls-button-color: var(--foreground);
		--xy-controls-button-color-hover: var(--accent-foreground);
		--xy-controls-button-border-color: var(--border);
		--xy-edge-label-background-color: var(--background);
		--xy-edge-label-color: var(--foreground);
	}
	.workflow-canvas :global(.svelte-flow__controls-button:focus-visible) {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	@media (max-width: 639px) {
		.workflow-canvas :global(.svelte-flow__controls) {
			bottom: 72px;
		}
	}
	@media (pointer: coarse) {
		.workflow-canvas :global(.svelte-flow__controls-button) {
			width: 44px;
			height: 44px;
		}
	}
</style>
