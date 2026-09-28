<script lang="ts">
	import { workflowGraph } from './graph';
	import type { Definition, Run } from './api';
	import { ThemeIcon } from '$lib/themes/icons';
	let { definition, run }: { definition: Definition; run?: Run } = $props();
	const graph = $derived(workflowGraph(definition, run));
	const bounds = $derived({
		x: Math.max(400, ...graph.nodes.map((node) => node.x + 220)),
		top: Math.min(-30, ...graph.nodes.map((node) => node.y - 30)),
		bottom: Math.max(110, ...graph.nodes.map((node) => node.y + 110))
	});
</script>

<div class="h-28 w-full overflow-hidden rounded-lg bg-muted/40" aria-hidden="true">
	<svg
		class="h-full w-full"
		viewBox={`-35 ${bounds.top} ${bounds.x + 70} ${bounds.bottom - bounds.top}`}
	>
		{#each graph.edges as edge}{@const from = graph.nodes.find(
				(node) => node.id === edge.source
			)!}{@const to = graph.nodes.find((node) => node.id === edge.target)!}<path
				d={`M ${from.x + 220} ${from.y + 38} C ${from.x + 260} ${from.y + 38},${to.x - 40} ${to.y + 38},${to.x} ${to.y + 38}`}
				fill="none"
				stroke="var(--muted-foreground)"
				stroke-width="3"
			/>{/each}
		{#each graph.nodes as node}<g transform={`translate(${node.x} ${node.y})`}
				><rect
					width="220"
					height="76"
					rx="12"
					fill="var(--card)"
					stroke={node.state === 'failed'
						? 'var(--destructive)'
						: node.state === 'succeeded'
							? 'var(--primary)'
							: 'var(--border)'}
					stroke-width="3"
				/><foreignObject x="12" y="12" width="196" height="52"
					><div class="flex h-full items-center gap-2 text-foreground">
						<ThemeIcon role={node.icon} class="size-6 shrink-0" /><span class="truncate text-lg"
							>{node.label}</span
						>
					</div></foreignObject
				></g
			>{/each}
	</svg>
</div>
