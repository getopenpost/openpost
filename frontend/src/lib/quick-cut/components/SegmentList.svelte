<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import AppSelect from '$lib/components/app-select.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as ContextMenu from '$lib/components/ui/context-menu';
	import { Input } from '$lib/components/ui/input';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import PlayIcon from '@lucide/svelte/icons/play';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import type { CutMode, QuickCutSegment, QuickCutSource } from '../types';
	import { formatTimecode, parseTimecode } from '../model';

	let {
		segments,
		sources,
		selectedId,
		defaultCutMode,
		onSelect,
		onRemove,
		onUpdate,
		onMove,
		exporting,
		canExportIndividually,
		onPreview,
		onExport
	}: {
		segments: QuickCutSegment[];
		sources: QuickCutSource[];
		selectedId: string | null;
		defaultCutMode: CutMode;
		onSelect: (id: string) => void;
		onRemove: (id: string) => void;
		onUpdate: (id: string, patch: Partial<QuickCutSegment>) => void;
		onMove: (from: number, to: number) => void;
		exporting: boolean;
		canExportIndividually: boolean;
		onPreview: (id: string) => void;
		onExport: (segment: QuickCutSegment) => void;
	} = $props();

	const sourceById = $derived(new Map(sources.map((s) => [s.id, s])));

	function commitTime(id: string, field: 'start' | 'end', value: string, sourceId: string) {
		const parsed = parseTimecode(value);
		if (parsed === null) return;
		const src = sourceById.get(sourceId);
		const duration = src?.duration ?? 0;
		const clamped = Math.max(0, Math.min(duration, parsed));
		if (field === 'start') onUpdate(id, { start: clamped });
		else onUpdate(id, { end: clamped });
	}

	function parseCutMode(value: string): CutMode | undefined {
		if (value === 'nearestKeyframe' || value === 'exact') return value;
		return undefined;
	}

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

<ul class="flex flex-col gap-2" role="list" aria-label={m.quick_cut_segments_label()}>
	{#each segments as seg, index (seg.id)}
		{@const src = sourceById.get(seg.sourceId)}
		<li>
			<ContextMenu.Root>
				<ContextMenu.Trigger>
					<div
						class="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-3 transition-colors {selectedId ===
						seg.id
							? 'border-primary ring-1 ring-primary/25'
							: 'border-border'} {seg.enabled === false ? 'opacity-60' : ''}"
						oncontextmenucapture={() => onSelect(seg.id)}
						onkeydowncapture={openContextMenuFromKeyboard}
					>
						<div class="flex min-w-0 items-start gap-3">
							<button
								type="button"
								class="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted px-2 font-mono text-xs font-medium tabular-nums hover:bg-accent {selectedId ===
								seg.id
									? 'bg-primary text-primary-foreground'
									: ''}"
								aria-pressed={selectedId === seg.id}
								aria-label={`${m.quick_cut_segment()} ${index + 1}`}
								onclick={() => onSelect(seg.id)}
							>
								#{index + 1}
							</button>

							<div class="min-w-0 flex-1">
								{#if src}
									<p class="truncate text-xs font-medium text-muted-foreground">
										{m.quick_cut_source_label({
											index: sources.findIndex((s) => s.id === seg.sourceId) + 1
										})} · {src.name}
									</p>
								{/if}
								<p class="mt-1 font-mono text-xs text-muted-foreground tabular-nums">
									{formatTimecode(seg.start)} → {formatTimecode(seg.end)} · {(
										seg.end - seg.start
									).toFixed(2)}s
								</p>
							</div>

							<div class="flex shrink-0 items-center gap-1">
								{#if segments.length > 1}
									<Button
										size="icon-xs"
										variant="ghost"
										aria-label={m.quick_cut_move_up()}
										disabled={index === 0}
										onclick={() => onMove(index, index - 1)}
										class="min-h-9 min-w-9"
									>
										<ChevronUpIcon class="size-4" aria-hidden="true" />
									</Button>
									<Button
										size="icon-xs"
										variant="ghost"
										aria-label={m.quick_cut_move_down()}
										disabled={index === segments.length - 1}
										onclick={() => onMove(index, index + 1)}
										class="min-h-9 min-w-9"
									>
										<ChevronDownIcon class="size-4" aria-hidden="true" />
									</Button>
								{/if}
								<Button
									size="icon-xs"
									variant="ghost"
									aria-label={m.quick_cut_remove_segment()}
									onclick={() => onRemove(seg.id)}
									class="min-h-9 min-w-9 text-muted-foreground hover:text-destructive"
								>
									<TrashIcon class="size-4" aria-hidden="true" />
								</Button>
							</div>
						</div>

						<div class="grid min-w-0 gap-3 sm:grid-cols-2">
							<label class="flex flex-col gap-1 text-xs">
								<span class="sr-only">{m.quick_cut_segment_name()} {index + 1}</span>
								<Input
									type="text"
									value={seg.name ?? ''}
									placeholder={m.quick_cut_segment_name_placeholder()}
									aria-label={`${m.quick_cut_segment_name()} ${index + 1}`}
									onchange={(event) =>
										onUpdate(seg.id, { name: event.currentTarget.value.trim() || undefined })}
									class="h-11 min-h-11 min-w-0 text-sm md:h-9 md:min-h-9"
								/>
							</label>
							<label class="flex min-w-0 flex-col gap-1 text-xs">
								<span class="text-muted-foreground">{m.quick_cut_cut_mode()}</span>
								<AppSelect
									value={seg.cutMode ?? ''}
									ariaLabel={`${m.quick_cut_cut_mode()} ${index + 1}`}
									options={[
										{
											value: '',
											label: m.quick_cut_cut_mode_project({
												mode:
													defaultCutMode === 'exact'
														? m.quick_cut_cut_mode_exact()
														: m.quick_cut_cut_mode_nearest()
											})
										},
										{ value: 'nearestKeyframe', label: m.quick_cut_cut_mode_nearest() },
										{ value: 'exact', label: m.quick_cut_cut_mode_exact() }
									]}
									onValueChange={(value) => onUpdate(seg.id, { cutMode: parseCutMode(value) })}
									class="h-11 w-full min-w-0 text-xs md:h-9"
								/>
							</label>
						</div>

						<div class="grid min-w-0 grid-cols-2 gap-3">
							<label class="flex min-w-0 flex-col gap-1 text-xs">
								<span class="text-muted-foreground">{m.quick_cut_in()}</span>
								<Input
									type="text"
									inputmode="decimal"
									value={formatTimecode(seg.start)}
									aria-label={`${m.quick_cut_in()} ${index + 1}`}
									onchange={(e) => commitTime(seg.id, 'start', e.currentTarget.value, seg.sourceId)}
									class="h-11 min-h-11 min-w-0 font-mono text-sm tabular-nums md:h-9 md:min-h-9"
								/>
							</label>
							<label class="flex min-w-0 flex-col gap-1 text-xs">
								<span class="text-muted-foreground">{m.quick_cut_out()}</span>
								<Input
									type="text"
									inputmode="decimal"
									value={formatTimecode(seg.end)}
									aria-label={`${m.quick_cut_out()} ${index + 1}`}
									onchange={(e) => commitTime(seg.id, 'end', e.currentTarget.value, seg.sourceId)}
									class="h-11 min-h-11 min-w-0 font-mono text-sm tabular-nums md:h-9 md:min-h-9"
								/>
							</label>
						</div>

						<div class="flex items-center justify-end gap-2 border-t pt-3">
							<Button
								size="xs"
								variant="ghost"
								disabled={seg.enabled === false}
								onclick={() => onPreview(seg.id)}
								class="min-h-11 gap-1.5 md:min-h-9"
							>
								<PlayIcon class="size-3.5" aria-hidden="true" />
								{m.quick_cut_preview()}
							</Button>
							<Button
								size="xs"
								disabled={exporting || seg.enabled === false || !canExportIndividually}
								onclick={() => onExport(seg)}
								class="min-h-11 gap-1.5 md:min-h-9"
							>
								<DownloadIcon class="size-3.5" aria-hidden="true" />
								{m.quick_cut_export()}
							</Button>
						</div>
					</div>
				</ContextMenu.Trigger>
				<ContextMenu.Content class="w-52">
					<ContextMenu.Item disabled={seg.enabled === false} onclick={() => onPreview(seg.id)}>
						{m.quick_cut_preview()}
					</ContextMenu.Item>
					<ContextMenu.Item
						disabled={exporting || seg.enabled === false || !canExportIndividually}
						onclick={() => onExport(seg)}
					>
						{m.quick_cut_export()}
					</ContextMenu.Item>
					<ContextMenu.Item onclick={() => onUpdate(seg.id, { enabled: seg.enabled === false })}>
						{seg.enabled === false ? m.quick_cut_enable_segment() : m.quick_cut_disable_segment()}
					</ContextMenu.Item>
					<ContextMenu.Separator />
					<ContextMenu.Item disabled={index === 0} onclick={() => onMove(index, index - 1)}>
						{m.quick_cut_move_up()}
					</ContextMenu.Item>
					<ContextMenu.Item
						disabled={index === segments.length - 1}
						onclick={() => onMove(index, index + 1)}
					>
						{m.quick_cut_move_down()}
					</ContextMenu.Item>
					<ContextMenu.Separator />
					<ContextMenu.Item variant="destructive" onclick={() => onRemove(seg.id)}>
						{m.quick_cut_remove_segment()}
					</ContextMenu.Item>
				</ContextMenu.Content>
			</ContextMenu.Root>
		</li>
	{/each}
</ul>

{#if segments.length === 0}
	<p class="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
		{m.quick_cut_no_segments()}
	</p>
{/if}
