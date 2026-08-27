<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import AppSelect from '$lib/components/app-select.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
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
		onMove
	}: {
		segments: QuickCutSegment[];
		sources: QuickCutSource[];
		selectedId: string | null;
		defaultCutMode: CutMode;
		onSelect: (id: string) => void;
		onRemove: (id: string) => void;
		onUpdate: (id: string, patch: Partial<QuickCutSegment>) => void;
		onMove: (from: number, to: number) => void;
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
</script>

<ul class="flex flex-col gap-2" role="list" aria-label={m.quick_cut_segments_label()}>
	{#each segments as seg, index (seg.id)}
		{@const src = sourceById.get(seg.sourceId)}
		<li
			class="flex flex-col gap-2 rounded-xl border bg-card p-3 shadow-sm transition sm:flex-row sm:items-center sm:gap-3 {selectedId ===
			seg.id
				? 'border-primary ring-1 ring-primary/30'
				: 'border-border'}"
		>
			<button
				type="button"
				class="flex min-h-11 min-w-11 items-center justify-center rounded-md border border-transparent bg-muted px-2 py-2 font-mono text-xs tabular-nums hover:bg-accent sm:min-h-9 {selectedId ===
				seg.id
					? 'bg-primary text-primary-foreground'
					: ''}"
				aria-pressed={selectedId === seg.id}
				aria-label={`${m.quick_cut_segment()} ${index + 1}`}
				onclick={() => onSelect(seg.id)}
			>
				#{index + 1}
			</button>

			<div class="flex flex-1 flex-col gap-2">
				{#if src}
					<span class="text-xs font-medium text-muted-foreground"
						>{m.quick_cut_source_label({
							index: sources.findIndex((s) => s.id === seg.sourceId) + 1
						})} · {src.name}</span
					>
				{/if}
				<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
					<label class="flex flex-1 flex-col gap-1 text-xs">
						<span class="text-muted-foreground"
							>{m.quick_cut_in()} · {formatTimecode(seg.start)}</span
						>
						<Input
							type="text"
							inputmode="decimal"
							value={formatTimecode(seg.start)}
							aria-label={`${m.quick_cut_in()} ${index + 1}`}
							onchange={(e) => commitTime(seg.id, 'start', e.currentTarget.value, seg.sourceId)}
							class="h-11 min-h-11 font-mono text-sm tabular-nums md:h-9 md:min-h-9"
						/>
					</label>
					<span class="hidden self-center text-muted-foreground sm:block">→</span>
					<label class="flex flex-1 flex-col gap-1 text-xs">
						<span class="text-muted-foreground"
							>{m.quick_cut_out()} · {formatTimecode(seg.end)}</span
						>
						<Input
							type="text"
							inputmode="decimal"
							value={formatTimecode(seg.end)}
							aria-label={`${m.quick_cut_out()} ${index + 1}`}
							onchange={(e) => commitTime(seg.id, 'end', e.currentTarget.value, seg.sourceId)}
							class="h-11 min-h-11 font-mono text-sm tabular-nums md:h-9 md:min-h-9"
						/>
					</label>
					<span
						class="rounded bg-muted px-2 py-1 text-center font-mono text-xs text-muted-foreground tabular-nums"
						>{(seg.end - seg.start).toFixed(2)}s</span
					>
				</div>
				<div class="flex min-h-11 items-center gap-2 text-xs md:min-h-9">
					<span class="shrink-0 text-muted-foreground">{m.quick_cut_cut_mode()}</span>
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
						class="h-11 min-w-0 flex-1 text-xs md:h-9"
					/>
				</div>
			</div>

			<div class="flex items-center gap-1">
				<Button
					size="icon-xs"
					variant="ghost"
					aria-label={m.quick_cut_move_up()}
					disabled={index === 0}
					onclick={() => onMove(index, index - 1)}
					class="min-h-11 min-w-11 md:min-h-7 md:min-w-7"
				>
					↑
				</Button>
				<Button
					size="icon-xs"
					variant="ghost"
					aria-label={m.quick_cut_move_down()}
					disabled={index === segments.length - 1}
					onclick={() => onMove(index, index + 1)}
					class="min-h-11 min-w-11 md:min-h-7 md:min-w-7"
				>
					↓
				</Button>
				<Button
					size="icon-xs"
					variant="ghost"
					aria-label={m.quick_cut_remove_segment()}
					onclick={() => onRemove(seg.id)}
					class="min-h-11 min-w-11 md:min-h-7 md:min-w-7"
				>
					×
				</Button>
			</div>
		</li>
	{/each}
</ul>

{#if segments.length === 0}
	<p class="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
		{m.quick_cut_no_segments()}
	</p>
{/if}
