<script lang="ts">
	import {
		SvelteFlow,
		Background,
		Controls,
		type Node,
		type Edge,
		type FitViewOptions
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { mode } from 'mode-watcher';
	import WorkflowNode, { type WorkflowNodeData } from './node.svelte';
	import { actionCatalog, sourceLabel } from './catalog';
	import type { Definition, Step } from './api';
	import { m } from '$lib/paraglide/messages';
	let {
		definition,
		selectedID,
		onselect
	}: { definition: Definition; selectedID: string; onselect: (id: string) => void } = $props();
	type SequenceLayout = { ends: string[]; y: number };
	const nodeTypes = { workflow: WorkflowNode };
	const fitViewOptions: FitViewOptions = {
		padding: { top: '32px', bottom: '76px', left: '24px', right: '24px' },
		maxZoom: 1
	};
	const graph = $derived.by(() => {
		const nodes: Node<WorkflowNodeData>[] = [
			{
				id: 'source',
				type: 'workflow',
				position: { x: 0, y: 0 },
				selected: selectedID === 'source',
				data: {
					label: sourceLabel(definition.source.kind),
					description: m.workflows_source(),
					icon: definition.source.kind === 'github_release' ? 'github' : 'download',
					source: true,
					onselect: () => onselect('source')
				}
			}
		];
		const edges: Edge[] = [];
		function width(steps: Step[]): number {
			return Math.max(
				1,
				...steps.map((step) =>
					step.kind === 'condition' ? width(step.then ?? []) + width(step.else ?? []) : 1
				)
			);
		}
		function sequence(
			steps: Step[],
			x: number,
			y: number,
			parents: string[],
			label?: string
		): SequenceLayout {
			let ends = parents;
			for (const step of steps) {
				const entry = actionCatalog().find((entry) => entry.kind === step.kind);
				nodes.push({
					id: step.id,
					type: 'workflow',
					position: { x, y },
					selected: selectedID === step.id,
					data: {
						label: step.name || entry?.label || step.kind,
						description: entry?.description ?? '',
						icon: entry?.icon ?? 'settings',
						onselect: () => onselect(step.id)
					}
				});
				for (const parent of ends)
					edges.push({
						id: `${parent}:${step.id}`,
						source: parent,
						target: step.id,
						type: 'smoothstep',
						label,
						style: 'stroke: var(--muted-foreground); stroke-width: 1.5',
						labelStyle: 'fill: var(--foreground)'
					});
				label = undefined;
				ends = [step.id];
				y += 145;
				if (step.kind === 'condition') {
					const branches = (['then', 'else'] as const).map((branch) => {
						const label = branch === 'then' ? m.workflows_yes() : m.workflows_no();
						const branchX =
							branch === 'then'
								? x - width(step.else ?? []) * 165
								: x + width(step.then ?? []) * 165;
						const id = `$branch:${step.id}:${branch}`;
						nodes.push({
							id,
							type: 'workflow',
							position: { x: branchX, y },
							data: {
								label,
								description: branch === 'then' ? m.workflows_add_yes() : m.workflows_add_no(),
								icon: 'add',
								onselect: () => onselect(step.id)
							}
						});
						edges.push({
							id: `${step.id}:${id}`,
							source: step.id,
							target: id,
							type: 'smoothstep',
							label,
							style: 'stroke: var(--muted-foreground)'
						});
						return sequence(step[branch] ?? [], branchX, y + 145, [id]);
					});
					const [left, right] = branches;
					ends = [...new Set([...left.ends, ...right.ends])];
					y = Math.max(left.y, right.y);
				}
			}
			return { ends, y };
		}
		sequence(definition.steps ?? [], 0, 145, ['source']);
		return { nodes, edges };
	});
</script>

<div class="workflow-canvas h-full min-h-[340px] bg-background" aria-label={m.workflows_canvas()}>
	<SvelteFlow
		nodes={graph.nodes}
		edges={graph.edges}
		{nodeTypes}
		fitView
		{fitViewOptions}
		minZoom={0.25}
		maxZoom={1.5}
		nodesDraggable={false}
		nodesConnectable={false}
		nodesFocusable={false}
		edgesFocusable={false}
		deleteKey={[]}
		colorMode={mode.current ?? 'light'}
		ariaLabelConfig={{
			'controls.ariaLabel': m.image_editor_zoom(),
			'controls.zoomIn.ariaLabel': m.image_editor_zoom_in(),
			'controls.zoomOut.ariaLabel': m.image_editor_zoom_out(),
			'controls.fitView.ariaLabel': m.image_editor_fit_canvas()
		}}
		attributionPosition="bottom-left"
	>
		<Background gap={20} size={1} patternColor="var(--border)" />
		<Controls showLock={false} position="bottom-right" orientation="horizontal" {fitViewOptions} />
	</SvelteFlow>
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
	@media (pointer: coarse) {
		.workflow-canvas :global(.svelte-flow__controls-button) {
			width: 44px;
			height: 44px;
		}
	}
	.workflow-canvas :global(.svelte-flow__controls-button:focus-visible) {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
</style>
