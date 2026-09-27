<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import AppSelect from '$lib/components/app-select.svelte';
	import { toast } from 'svelte-sonner';
	import { timelineStore } from '../timeline/stores/timeline-store.svelte';
	import { executeAtomic } from '../timeline/commands/command-store.svelte';
	import { trimItemEnd, updateItemProperties } from '../timeline/actions/items';
	import type { TimelineItem } from '../project/types';
	import { timerTiming, type TimerSettings } from '../timers/timer';
	let { item, onedit }: { item: TimelineItem; onedit: () => void } = $props();
	function update(patch: Partial<TimerSettings>): void {
		if (!item.timer) return;
		updateItemProperties(item.id, { timer: { ...item.timer, ...patch } }, 'UPDATE_TIMER');
		onedit();
	}
	function resize(seconds: number, hold = item.timer?.finishHoldSeconds ?? 0): void {
		if (
			!Number.isFinite(seconds) ||
			seconds <= 0 ||
			!Number.isFinite(hold) ||
			hold < 0 ||
			hold > 10
		)
			return;
		executeAtomic('RESIZE_TIMER', () => {
			if (!trimItemEnd(item.id, item.from + Math.round((seconds + hold) * timelineStore.fps))) {
				toast.error(m.video_editor_repeat_blocked());
				return;
			}
			update({ finishHoldSeconds: hold });
		});
	}
</script>

{#if item.timer}
	<section class="grid gap-2 border-b border-[var(--video-editor-border)] pb-3">
		<label class="grid gap-1 text-xs"
			>{m.video_editor_timer_length()}<Input
				type="number"
				min={0.1}
				max={3600}
				step={0.1}
				value={timerTiming(item.timer, item.durationInFrames, timelineStore.fps).activeFrames /
					timelineStore.fps}
				onchange={(event) => resize(Number(event.currentTarget.value))}
			/></label
		>
		<label class="grid gap-1 text-xs"
			>{m.video_editor_timer_hold()}<Input
				type="number"
				min={0}
				max={10}
				step={0.1}
				value={item.timer.finishHoldSeconds ?? 0}
				onchange={(event) =>
					resize(
						timerTiming(item.timer!, item.durationInFrames, timelineStore.fps).activeFrames /
							timelineStore.fps,
						Number(event.currentTarget.value)
					)}
			/></label
		>
		<AppSelect
			ariaLabel={m.video_editor_timer_direction()}
			value={item.timer.direction}
			options={[
				{ value: 'down', label: m.video_editor_timer_down() },
				{ value: 'up', label: m.video_editor_timer_up() }
			]}
			onValueChange={(value) => update({ direction: value as TimerSettings['direction'] })}
		/>
		<AppSelect
			ariaLabel={m.video_editor_timer_format()}
			value={item.timer.format}
			options={[
				{ value: 'clock', label: '00:00' },
				{ value: 'seconds', label: m.video_editor_timer_seconds() },
				{ value: 'percent', label: '%' }
			]}
			onValueChange={(value) => update({ format: value as TimerSettings['format'] })}
		/>
		<label class="grid gap-1 text-xs"
			>{m.video_editor_timer_finish()}<Input
				value={item.timer.finishText ?? ''}
				maxlength={40}
				onchange={(event) => update({ finishText: event.currentTarget.value })}
			/></label
		>
		<label class="flex items-center gap-2 text-xs [@media(pointer:coarse)]:min-h-11"
			><Checkbox
				checked={item.timer.warningSound ?? false}
				onCheckedChange={(value) => update({ warningSound: value })}
			/>{m.video_editor_timer_warning_sound()}</label
		>
		<p class="text-xs text-[var(--video-editor-muted)]">{m.video_editor_timer_duration_hint()}</p>
	</section>
{/if}
