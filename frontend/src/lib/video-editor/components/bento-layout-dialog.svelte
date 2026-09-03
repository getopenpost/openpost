<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Dialog from '$lib/components/ui/dialog';
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import { transitionsStore } from '$lib/video-editor/timeline/actions/transitions-store.svelte';
	import {
		applyBentoLayout,
		eligibleBentoItemIds
	} from '$lib/video-editor/timeline/actions/bento-layout';
	import {
		bentoSourceSize,
		buildBentoTransitionChains,
		computeBentoLayout,
		type BentoLayoutConfig,
		type BentoLayoutPreset
	} from '$lib/video-editor/timeline/bento-layout';
	import {
		loadBentoPresets,
		saveBentoPresets,
		type CustomBentoPreset
	} from '$lib/video-editor/timeline/bento-presets';

	interface BuiltInPreset {
		id: string;
		preset: BentoLayoutPreset;
		label: () => string;
		cols?: number;
		rows?: number;
	}

	const builtIns: BuiltInPreset[] = [
		{ id: 'auto', preset: 'auto', label: m.video_editor_bento_auto },
		{ id: 'row', preset: 'row', label: m.video_editor_bento_row },
		{ id: 'column', preset: 'column', label: m.video_editor_bento_column },
		{ id: 'pip', preset: 'pip', label: m.video_editor_bento_pip },
		{
			id: 'focus-sidebar',
			preset: 'focus-sidebar',
			label: m.video_editor_bento_focus_sidebar
		},
		{ id: 'grid-2', preset: 'grid', cols: 2, rows: 2, label: m.video_editor_bento_grid_2 },
		{ id: 'grid-3', preset: 'grid', cols: 3, rows: 3, label: m.video_editor_bento_grid_3 }
	];

	let {
		open = $bindable(false),
		itemIds,
		canvasWidth = 1920,
		canvasHeight = 1080,
		onapplied = () => {}
	}: {
		open?: boolean;
		itemIds: string[];
		canvasWidth?: number;
		canvasHeight?: number;
		onapplied?: (ids: string[]) => void;
	} = $props();

	let selectedKey = $state('builtin:auto');
	let gap = $state(0);
	let padding = $state(0);
	let chainOrder = $state<string[][]>([]);
	let customPresets = $state<CustomBentoPreset[]>([]);
	let savingPreset = $state(false);
	let presetName = $state('');
	let draggedIndex = $state<number | null>(null);
	let initializedSignature = '';

	const eligibleIds = $derived(eligibleBentoItemIds(itemIds));
	const itemsById = $derived(timelineStore.itemById);
	const config = $derived.by(resolveConfig);
	const previewTransforms = $derived.by(() => {
		const representatives = chainOrder.flatMap((chain) => {
			const item = itemsById.get(chain[0] ?? '');
			return item ? [{ id: item.id, ...bentoSourceSize(item, canvasWidth, canvasHeight) }] : [];
		});
		return computeBentoLayout(representatives, canvasWidth, canvasHeight, config);
	});

	$effect(() => {
		if (!open) return;
		const signature = JSON.stringify({
			ids: eligibleIds,
			transitions: transitionsStore.list.map((transition) => [
				transition.id,
				transition.fromItemId,
				transition.toItemId
			])
		});
		if (signature === initializedSignature) return;
		initializedSignature = signature;
		chainOrder = buildBentoTransitionChains(eligibleIds, transitionsStore.list);
		selectedKey = 'builtin:auto';
		gap = 0;
		padding = 0;
		customPresets = loadBentoPresets();
		savingPreset = false;
		presetName = '';
	});

	$effect(() => {
		if (!open) initializedSignature = '';
	});

	function resolveConfig(): BentoLayoutConfig {
		const safeGap = Math.max(0, Math.min(500, Number(gap) || 0));
		const safePadding = Math.max(0, Math.min(500, Number(padding) || 0));
		if (selectedKey.startsWith('custom:')) {
			const preset = customPresets.find(
				(candidate) => candidate.id === selectedKey.slice('custom:'.length)
			);
			if (preset) return { ...preset, gap: safeGap, padding: safePadding };
		}
		const preset =
			builtIns.find((candidate) => candidate.id === selectedKey.slice('builtin:'.length)) ??
			builtIns[0]!;
		return {
			preset: preset.preset,
			cols: preset.cols,
			rows: preset.rows,
			gap: safeGap,
			padding: safePadding
		};
	}

	function selectBuiltIn(preset: BuiltInPreset): void {
		selectedKey = `builtin:${preset.id}`;
	}

	function selectCustom(preset: CustomBentoPreset): void {
		selectedKey = `custom:${preset.id}`;
		gap = preset.gap ?? 0;
		padding = preset.padding ?? 0;
	}

	function chainName(chain: readonly string[]): string {
		return chain.map((id) => itemsById.get(id)?.label ?? id.slice(0, 6)).join(' + ');
	}

	function moveChain(from: number, to: number): void {
		if (from === to || from < 0 || to < 0 || from >= chainOrder.length || to >= chainOrder.length)
			return;
		const next = [...chainOrder];
		[next[from], next[to]] = [next[to]!, next[from]!];
		chainOrder = next;
	}

	function savePreset(): void {
		const name = presetName.trim();
		if (!name) return;
		const preset: CustomBentoPreset = {
			id: crypto.randomUUID(),
			name: name.slice(0, 80),
			...config
		};
		customPresets = [...customPresets, preset];
		saveBentoPresets(customPresets);
		selectCustom(preset);
		presetName = '';
		savingPreset = false;
	}

	function deletePreset(id: string): void {
		customPresets = customPresets.filter((preset) => preset.id !== id);
		saveBentoPresets(customPresets);
		if (selectedKey === `custom:${id}`) selectedKey = 'builtin:auto';
	}

	function applyLayout(): void {
		const applied = applyBentoLayout({
			itemIds: eligibleIds,
			canvasWidth,
			canvasHeight,
			config,
			orderedChains: chainOrder
		});
		if (applied.length < 2) return;
		onapplied(applied);
		open = false;
	}

	function previewStyle(id: string): string {
		const transform = previewTransforms.get(id);
		if (!transform?.width || !transform.height) return 'display:none';
		const left = ((canvasWidth / 2 + (transform.x ?? 0) - transform.width / 2) / canvasWidth) * 100;
		const top =
			((canvasHeight / 2 + (transform.y ?? 0) - transform.height / 2) / canvasHeight) * 100;
		return `left:${left}%;top:${top}%;width:${(transform.width / canvasWidth) * 100}%;height:${(transform.height / canvasHeight) * 100}%`;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class="video-editor-theme flex max-h-[min(92dvh,820px)] w-[calc(100%-1rem)] max-w-2xl flex-col overflow-hidden border-border bg-popover p-0 text-popover-foreground shadow-2xl sm:max-w-2xl"
	>
		<Dialog.Header class="border-b border-border px-5 py-4 pr-12">
			<Dialog.Title class="text-base">{m.video_editor_bento_title()}</Dialog.Title>
			<Dialog.Description class="mt-0.5 text-xs text-[var(--video-editor-muted)]">
				{m.video_editor_bento_description({ count: eligibleIds.length })}
			</Dialog.Description>
		</Dialog.Header>

		<div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
			<div class="flex flex-wrap gap-1.5" aria-label={m.video_editor_bento_title()}>
				{#each builtIns as preset (preset.id)}
					<button
						type="button"
						class="min-h-9 rounded-md border border-border px-2.5 text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring data-[active=true]:border-selection data-[active=true]:bg-selection data-[active=true]:text-selection-foreground"
						data-active={selectedKey === `builtin:${preset.id}`}
						aria-pressed={selectedKey === `builtin:${preset.id}`}
						onclick={() => selectBuiltIn(preset)}
					>
						{preset.label()}
					</button>
				{/each}
				{#each customPresets as preset (preset.id)}
					<div class="flex items-center rounded-md border border-border">
						<button
							type="button"
							class="min-h-9 rounded-l-md px-2.5 text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring data-[active=true]:bg-selection data-[active=true]:text-selection-foreground"
							data-active={selectedKey === `custom:${preset.id}`}
							aria-pressed={selectedKey === `custom:${preset.id}`}
							onclick={() => selectCustom(preset)}
						>
							{preset.name}
						</button>
						<button
							type="button"
							class="flex size-9 items-center justify-center rounded-r-md text-muted-foreground hover:bg-destructive/15 hover:text-destructive focus-visible:outline-2 focus-visible:outline-ring"
							aria-label={m.video_editor_bento_delete_preset({ name: preset.name })}
							onclick={() => deletePreset(preset.id)}
						>
							<ThemeIcon role="delete" class="size-3.5" />
						</button>
					</div>
				{/each}
			</div>

			<div
				class="editor-protected-surface relative mx-auto w-full max-w-xl overflow-hidden rounded-lg border border-[var(--canvas-grid)] bg-[var(--canvas-pasteboard)]"
				data-editor-protected="bento-layout-preview"
				style={`aspect-ratio:${Math.max(1, canvasWidth)}/${Math.max(1, canvasHeight)}`}
				role="group"
				aria-label={m.video_editor_bento_preview()}
			>
				{#each chainOrder as chain, index (chain[0])}
					<button
						type="button"
						draggable="true"
						class="absolute flex min-h-6 min-w-6 cursor-grab items-center justify-center overflow-hidden rounded border border-[var(--canvas-selection)] bg-[color-mix(in_oklch,var(--canvas-selection)_68%,var(--canvas-pasteboard))] px-1 text-[10px] font-medium text-[var(--editor-protected-glyph)] shadow-sm focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-[var(--canvas-handle)] active:cursor-grabbing"
						style={previewStyle(chain[0] ?? '')}
						aria-label={`${index + 1}. ${chainName(chain)}`}
						ondragstart={() => (draggedIndex = index)}
						ondragend={() => (draggedIndex = null)}
						ondragover={(event) => event.preventDefault()}
						ondrop={(event) => {
							event.preventDefault();
							if (draggedIndex !== null) moveChain(draggedIndex, index);
							draggedIndex = null;
						}}
					>
						<span class="truncate">{chainName(chain)}</span>
					</button>
				{/each}
			</div>

			<div class="grid gap-3 sm:grid-cols-[1fr_auto]">
				<section class="rounded-lg border border-border p-3" aria-labelledby="bento-order-title">
					<h3 id="bento-order-title" class="text-xs font-medium">
						{m.video_editor_bento_order()}
					</h3>
					<p class="mt-0.5 text-[11px] text-[var(--video-editor-muted)]">
						{m.video_editor_bento_order_hint()}
					</p>
					<div class="mt-2 grid gap-1.5 sm:grid-cols-2">
						{#each chainOrder as chain, index (chain[0])}
							<div class="flex min-w-0 items-center gap-1 rounded bg-muted p-1 pl-2">
								<span class="min-w-0 flex-1 truncate text-xs">{index + 1}. {chainName(chain)}</span>
								<button
									type="button"
									class="flex size-8 items-center justify-center rounded hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-30"
									disabled={index === 0}
									aria-label={m.video_editor_bento_move_earlier({ name: chainName(chain) })}
									onclick={() => moveChain(index, index - 1)}
								>
									<ThemeIcon role="chevron-up" class="size-3.5" />
								</button>
								<button
									type="button"
									class="flex size-8 items-center justify-center rounded hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-30"
									disabled={index === chainOrder.length - 1}
									aria-label={m.video_editor_bento_move_later({ name: chainName(chain) })}
									onclick={() => moveChain(index, index + 1)}
								>
									<ThemeIcon role="chevron-down" class="size-3.5" />
								</button>
							</div>
						{/each}
					</div>
				</section>

				<div class="grid grid-cols-2 content-start gap-2 sm:w-48">
					<label class="space-y-1 text-xs">
						<span class="text-[var(--video-editor-muted)]">{m.video_editor_bento_gap()}</span>
						<Input type="number" min="0" max="500" bind:value={gap} class="h-9" />
					</label>
					<label class="space-y-1 text-xs">
						<span class="text-[var(--video-editor-muted)]">{m.video_editor_bento_padding()}</span>
						<Input type="number" min="0" max="500" bind:value={padding} class="h-9" />
					</label>
				</div>
			</div>

			<div
				class="flex items-start gap-2 rounded-md border border-warning/25 bg-warning/8 p-3 text-xs text-warning-foreground"
			>
				<ProtectedIcon icon="warning" class="mt-0.5 size-4 shrink-0" />
				<p>{m.video_editor_bento_motion_warning()}</p>
			</div>

			{#if savingPreset}
				<div
					class="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-end"
				>
					<label class="min-w-0 flex-1 space-y-1 text-xs">
						<span class="text-[var(--video-editor-muted)]"
							>{m.video_editor_bento_preset_name()}</span
						>
						<Input
							bind:value={presetName}
							maxlength={80}
							placeholder={m.video_editor_bento_preset_name_placeholder()}
							onkeydown={(event) => {
								if (event.key === 'Enter') savePreset();
								if (event.key === 'Escape') savingPreset = false;
							}}
						/>
					</label>
					<Button size="sm" variant="secondary" disabled={!presetName.trim()} onclick={savePreset}>
						{m.video_editor_bento_save_preset()}
					</Button>
				</div>
			{/if}
		</div>

		<Dialog.Footer
			class="flex-row justify-between border-t border-border px-5 py-3 sm:justify-between"
		>
			<Button variant="ghost" size="sm" onclick={() => (savingPreset = !savingPreset)}>
				{m.video_editor_bento_new_preset()}
			</Button>
			<div class="flex gap-2">
				<Button variant="ghost" onclick={() => (open = false)}>
					{m.video_editor_bento_cancel()}
				</Button>
				<Button disabled={eligibleIds.length < 2} onclick={applyLayout}>
					{m.video_editor_bento_apply()}
				</Button>
			</div>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
