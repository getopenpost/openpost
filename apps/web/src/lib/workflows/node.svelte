<script module lang="ts">
	import type { GraphNode, Port } from './graph';
	export type WorkflowNodeData = GraphNode & {
		onduplicate?: () => void;
		onremove?: () => void;
		onselect: () => void;
		onadd?: (port: Port) => void;
		readonly?: boolean;
	};
</script>

<script lang="ts">
	import { Handle, Position, type Node, type NodeProps } from '@xyflow/svelte';
	import { ThemeIcon } from '$lib/themes/icons';
	import NodeIcon from './node-icon.svelte';
	import * as ContextMenu from '$lib/components/ui/context-menu';
	import { m } from '$lib/paraglide/messages';
	let { data: info, selected }: NodeProps<Node<WorkflowNodeData>> = $props();
	const ports = $derived<Port[]>(info.branch ? ['then', 'else'] : ['after']);
</script>

{#if !info.source}<Handle
		type="target"
		position={Position.Left}
		isConnectable={!info.readonly}
		class="!size-3 !border-2 !border-background !bg-muted-foreground"
	/>{/if}
<div class="relative">
	<ContextMenu.Root>
		<ContextMenu.Trigger>
			<button
				type="button"
				onkeydown={(event) => {
					if (event.isComposing || event.altKey) return;
					if (!info.readonly && (event.key === 'Delete' || event.key === 'Backspace')) {
						if (info.onremove) {
							event.preventDefault();
							info.onremove();
						}
						return;
					}
					if (
						!info.readonly &&
						(event.metaKey || event.ctrlKey) &&
						event.key.toLowerCase() === 'd'
					) {
						if (info.onduplicate) {
							event.preventDefault();
							info.onduplicate();
						}
						return;
					}
					if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
						event.preventDefault();
						const bounds = event.currentTarget.getBoundingClientRect();
						event.currentTarget.dispatchEvent(
							new MouseEvent('contextmenu', {
								bubbles: true,
								cancelable: true,
								clientX: bounds.left + 24,
								clientY: bounds.top + 24
							})
						);
					}
				}}
				onclick={info.onselect}
				class="flex min-h-[76px] w-[220px] items-center gap-3 rounded-xl border bg-card px-3 py-3 text-left text-card-foreground shadow-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring {info.issues
					? 'border-destructive'
					: selected
						? 'border-ring ring-1 ring-ring'
						: 'border-border'}"
				aria-pressed={selected}
			>
				<NodeIcon icon={info.icon} category={info.category} size="lg" />
				<span class="min-w-0"
					><span class="block truncate text-sm font-medium">{info.label}</span><span
						class="mt-1 block truncate text-xs text-muted-foreground"
						>{info.issues ? m.workflows_needs_attention() : info.description}</span
					></span
				>
				{#if info.issues}<ThemeIcon
						role="feedback"
						class="size-4 shrink-0 text-destructive"
					/>{:else if info.state === 'succeeded'}<ThemeIcon
						role="check"
						class="size-4 shrink-0 text-success"
					/>{:else if info.state === 'failed'}<ThemeIcon
						role="feedback"
						class="size-4 shrink-0 text-destructive"
					/>{/if}
			</button>
		</ContextMenu.Trigger>
		<ContextMenu.Content class="[@media(pointer:coarse)]:[&_[role=menuitem]]:min-h-11">
			<ContextMenu.Item onSelect={info.onselect}
				><ThemeIcon role="edit" class="size-4" />{m.workflows_configure()}</ContextMenu.Item
			>
			{#if info.onadd}{#each ports as port}
					<ContextMenu.Item onSelect={() => info.onadd?.(port)}
						><ThemeIcon role="add" class="size-4" />{port === 'then'
							? m.workflows_add_yes()
							: port === 'else'
								? m.workflows_add_no()
								: m.workflows_add_after()}</ContextMenu.Item
					>
				{/each}{/if}
			{#if info.onduplicate}<ContextMenu.Item onSelect={info.onduplicate}
					><ThemeIcon role="copy" class="size-4" />{m.workflows_duplicate()}</ContextMenu.Item
				>{/if}
			{#if info.onremove}<ContextMenu.Separator /><ContextMenu.Item
					variant="destructive"
					onSelect={info.onremove}
					><ThemeIcon role="delete" class="size-4" />{m.common_delete()}</ContextMenu.Item
				>{/if}
		</ContextMenu.Content>
	</ContextMenu.Root>
	{#each ports as port}
		{@render outputPort(port)}
	{/each}
</div>

{#snippet outputPort(port: Port)}
	<Handle
		id={port}
		type="source"
		position={Position.Right}
		isConnectable={!info.readonly}
		style={`top:${port === 'then' ? 25 : port === 'else' ? 75 : 50}%`}
		class="!size-3 !border-2 !border-background !bg-muted-foreground"
	/>
	{#if info.branch}<span
			class="pointer-events-none absolute -right-7 rounded-sm bg-background px-0.5 text-[10px] text-muted-foreground"
			style={`top:${port === 'then' ? 25 : 75}%;transform:translateY(-50%)`}
			>{port === 'then' ? m.workflows_yes() : m.workflows_no()}</span
		>{/if}
	{#if info.onadd}<button
			type="button"
			class="nodrag nopan absolute -right-16 flex size-7 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [@media(pointer:coarse)]:size-11"
			style={`top:${port === 'then' ? 25 : port === 'else' ? 75 : 50}%;transform:translateY(-50%)`}
			aria-label={port === 'then'
				? m.workflows_add_yes()
				: port === 'else'
					? m.workflows_add_no()
					: m.workflows_add_after()}
			onclick={() => info.onadd?.(port)}><ThemeIcon role="add" class="size-4" /></button
		>{/if}
{/snippet}
