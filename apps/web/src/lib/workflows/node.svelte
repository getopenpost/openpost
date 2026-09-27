<script module lang="ts">
	import type { ThemeIconRole } from '$lib/themes';
	export type WorkflowNodeData = {
		label: string;
		description: string;
		icon: ThemeIconRole;
		source?: boolean;
		onselect: () => void;
	};
</script>

<script lang="ts">
	import { Handle, Position, type Node, type NodeProps } from '@xyflow/svelte';
	import { ThemeIcon } from '$lib/themes/icons';
	let { data: info, selected }: NodeProps<Node<WorkflowNodeData>> = $props();
</script>

{#if !info.source}<Handle
		type="target"
		aria-hidden="true"
		position={Position.Top}
		isConnectable={false}
		class="!border-border !bg-muted-foreground"
	/>{/if}
<button
	type="button"
	onclick={info.onselect}
	class="nodrag nopan flex w-[260px] items-start gap-3 rounded-lg border bg-card p-3 text-left text-card-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring {selected
		? 'border-ring ring-1 ring-ring'
		: 'border-border'}"
	aria-pressed={selected}
>
	<span class="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted"
		><ThemeIcon role={info.icon} class="size-4" /></span
	>
	<span class="min-w-0"
		><span class="block truncate text-sm font-medium">{info.label}</span><span
			class="mt-1 block text-xs leading-4 text-muted-foreground">{info.description}</span
		></span
	>
</button>
<Handle
	type="source"
	aria-hidden="true"
	position={Position.Bottom}
	isConnectable={false}
	class="!border-border !bg-muted-foreground"
/>
