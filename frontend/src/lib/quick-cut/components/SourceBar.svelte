<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import * as ContextMenu from '$lib/components/ui/context-menu';
	import type { QuickCutSource } from '../types';

	let {
		sources,
		activeSourceId,
		busy,
		onSelect,
		onReconnect,
		onRemove,
		onAdd
	}: {
		sources: QuickCutSource[];
		activeSourceId: string | null;
		busy: boolean;
		onSelect: (id: string) => void;
		onReconnect: (id: string) => void;
		onRemove: (id: string) => void;
		onAdd: () => void;
	} = $props();

	function openContextMenuFromKeyboard(event: KeyboardEvent): void {
		if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
		if (!(event.currentTarget instanceof HTMLElement)) return;
		event.preventDefault();
		const target = event.currentTarget;
		const bounds = target.getBoundingClientRect();
		target.dispatchEvent(
			new MouseEvent('contextmenu', {
				bubbles: true,
				cancelable: true,
				clientX: bounds.left + Math.min(24, bounds.width / 2),
				clientY: bounds.top + Math.min(24, bounds.height / 2)
			})
		);
	}
</script>

<div class="flex min-w-0 flex-wrap gap-2" role="group" aria-label={m.quick_cut_sources_label()}>
	{#each sources as source, index (source.id)}
		<ContextMenu.Root>
			<ContextMenu.Trigger>
				<div
					class="flex max-w-full min-w-0 items-center gap-1"
					oncontextmenucapture={() => onSelect(source.id)}
					onkeydowncapture={openContextMenuFromKeyboard}
				>
					<button
						type="button"
						class="flex min-h-11 max-w-full min-w-0 items-center gap-2 rounded-full border px-3 py-1 text-xs {activeSourceId ===
						source.id
							? 'border-primary bg-primary text-primary-foreground'
							: 'bg-card hover:bg-accent'}"
						aria-pressed={activeSourceId === source.id}
						onclick={() => onSelect(source.id)}
					>
						<span class="truncate font-medium"
							>{m.quick_cut_source_label({ index: index + 1 })} · {source.name}</span
						>
						{#if !source.file && !source.handle}
							<span class="rounded bg-destructive px-1 text-[10px] text-destructive-foreground"
								>{m.quick_cut_source_missing()}</span
							>
						{/if}
					</button>
					{#if !source.file && !source.handle}
						<Button
							size="xs"
							variant="outline"
							disabled={busy}
							onclick={() => onReconnect(source.id)}
							class="min-h-11"
						>
							{m.quick_cut_reconnect()}
						</Button>
					{/if}
				</div>
			</ContextMenu.Trigger>
			<ContextMenu.Content class="w-52">
				<ContextMenu.Item
					disabled={activeSourceId === source.id}
					onclick={() => onSelect(source.id)}
				>
					{m.quick_cut_select_source()}
				</ContextMenu.Item>
				<ContextMenu.Item disabled={busy} onclick={() => onReconnect(source.id)}>
					{m.quick_cut_reconnect()}
				</ContextMenu.Item>
				<ContextMenu.Separator />
				<ContextMenu.Item variant="destructive" disabled={busy} onclick={() => onRemove(source.id)}>
					{m.quick_cut_remove_source()}
				</ContextMenu.Item>
			</ContextMenu.Content>
		</ContextMenu.Root>
	{/each}
	<Button size="xs" variant="outline" disabled={busy} onclick={onAdd} class="min-h-11">
		{m.quick_cut_add_source()}
	</Button>
</div>
