<script lang="ts">
	import { workflowGraph } from './graph';
	import type { Definition, Run } from './api';
	import NodeIcon from './node-icon.svelte';
	let { definition, run }: { definition: Definition; run?: Run } = $props();
	const NODE_SIZE = 36;
	const COLUMN_GAP = 58;
	let width = $state(240);
	const graph = $derived(workflowGraph(definition, run));
	const columns = $derived(Math.max(1, Math.floor((width - 32 - NODE_SIZE) / COLUMN_GAP) + 1));
	const nodes = $derived(graph.nodes.filter((node) => node.x / 300 < columns));
	const hiddenCount = $derived(graph.nodes.length - nodes.length);
	const top = $derived(Math.min(0, ...nodes.map((node) => node.y)));
	const bottom = $derived(Math.max(0, ...nodes.map((node) => node.y)));
	const graphWidth = $derived(
		Math.max(0, ...nodes.map((node) => node.x / 300)) * COLUMN_GAP + NODE_SIZE
	);
	const left = $derived((width - graphWidth) / 2);
	const preview = $derived(
		nodes.map((node) => ({
			...node,
			x: left + (node.x / 300) * COLUMN_GAP,
			y: top === bottom ? 38 : 12 + ((node.y - top) / (bottom - top)) * 52
		}))
	);
	const edges = $derived(
		graph.edges.flatMap((edge) => {
			const from = preview.find((node) => node.id === edge.source);
			const to = preview.find((node) => node.id === edge.target);
			return from && to ? [{ ...edge, from, to }] : [];
		})
	);
</script>

<div
	bind:clientWidth={width}
	class="relative h-28 w-full overflow-hidden rounded-lg bg-muted/40"
	aria-hidden="true"
>
	<svg class="h-full w-full">
		{#each edges as edge}
			<path
				d={`M ${edge.from.x + NODE_SIZE} ${edge.from.y + NODE_SIZE / 2} C ${edge.from.x + NODE_SIZE + 12} ${edge.from.y + NODE_SIZE / 2},${edge.to.x - 12} ${edge.to.y + NODE_SIZE / 2},${edge.to.x} ${edge.to.y + NODE_SIZE / 2}`}
				fill="none"
				stroke="var(--muted-foreground)"
				stroke-width="1.5"
			/>
		{/each}
		{#each preview as node}
			<g transform={`translate(${node.x} ${node.y})`}>
				<foreignObject width={NODE_SIZE} height={NODE_SIZE}>
					<div class="flex h-full items-center justify-center">
						<NodeIcon icon={node.icon} category={node.category} />
					</div>
				</foreignObject>
				<rect
					width={NODE_SIZE}
					height={NODE_SIZE}
					rx={node.source ? 12 : 8}
					fill="none"
					stroke={node.state === 'failed'
						? 'var(--destructive)'
						: node.state === 'succeeded'
							? 'var(--success)'
							: 'none'}
					stroke-width="1.5"
				/>
			</g>
		{/each}
	</svg>
	{#if hiddenCount}<span
			class="absolute top-2 right-2 rounded-md border bg-card px-1.5 py-0.5 text-[11px] text-muted-foreground"
			>+{hiddenCount}</span
		>{/if}
</div>
