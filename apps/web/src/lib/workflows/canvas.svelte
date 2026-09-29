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
	import { MediaQuery } from 'svelte/reactivity';
	const narrow = new MediaQuery('(max-width: 639px)');
	import WorkflowNode, { type WorkflowNodeData } from './node.svelte';
	import { workflowGraph, type Port } from './graph';
	import type { Definition, Run } from './api';
	import type { Issue } from './validation';
	import { m } from '$lib/paraglide/messages';
	let {
		definition,
		positions = {},
		onlayout,
		selectedID,
		onselect,
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
		onadd?: (id: string, port: Port) => void;
		onduplicate?: (id: string) => void;
		onremove?: (id: string) => void;
		onconnect?: (source: string, target: string, port: Port) => void;
		run?: Run;
		issues?: Issue[];
		readonly?: boolean;
	} = $props();
	let layoutVersion = $state(0);
	export function organize() {
		onlayout?.({});
		layoutVersion++;
	}
	const nodeTypes = { workflow: WorkflowNode };
	const graph = $derived(workflowGraph(definition, run, issues));
	const nodes = $derived<Node<WorkflowNodeData>[]>(
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
	const connectEnd: OnConnectEnd = (event, state) => {
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
		if (!readonly)
			onconnect?.(connection.source, connection.target, outputPort(connection.sourceHandle));
	}
</script>

<div class="workflow-canvas h-full min-h-0 bg-background" aria-label={m.workflows_canvas()}>
	{#key layoutVersion}
		<SvelteFlow
			onnodedragstop={({ nodes: moved }) => {
				onlayout?.({
					...positions,
					...Object.fromEntries(moved.map((node) => [node.id, node.position]))
				});
			}}
			{nodes}
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
			onconnectend={connectEnd}
			onconnect={connect}
			colorMode={mode.current ?? 'light'}
			ariaLabelConfig={{
				'controls.ariaLabel': m.image_editor_zoom(),
				'controls.zoomIn.ariaLabel': m.image_editor_zoom_in(),
				'controls.zoomOut.ariaLabel': m.image_editor_zoom_out(),
				'controls.fitView.ariaLabel': m.image_editor_fit_canvas()
			}}
		>
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
