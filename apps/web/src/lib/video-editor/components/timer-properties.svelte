<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import AppSelect from '$lib/components/app-select.svelte';
	import ColorPicker from '$lib/components/color-picker.svelte';
	import { Disclosure } from '$lib/components/editor-density';
	import { Button } from '$lib/components/ui/button';
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
		<AppSelect
			ariaLabel={m.video_editor_text_span_style()}
			value={item.timer.style}
			options={[
				{ value: 'numbers', label: m.video_editor_tool_text() },
				{ value: 'ring', label: m.video_editor_timer_ring() },
				{ value: 'bar', label: m.video_editor_timer_bar() },
				{ value: 'bomb', label: m.video_editor_timer_bomb() },
				{ value: 'tomato', label: m.video_editor_timer_tomato() }
			]}
			onValueChange={(value) => update({ style: value as TimerSettings['style'] })}
		/>
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
		<Disclosure label={m.sidebar_appearance()}>
			<div class="grid gap-2 pt-2">
				<label class="flex items-center gap-2 text-xs [@media(pointer:coarse)]:min-h-11">
					<Checkbox
						checked={item.timer.showValue !== false}
						onCheckedChange={(showValue) => update({ showValue })}
					/>{m.video_editor_timer_show_value()}
				</label>
				{#if item.timer.style === 'ring' || item.timer.style === 'bar'}
					<div class="grid gap-1 text-xs">
						<span>{m.video_editor_timer_progress_color()}</span>
						<ColorPicker
							label={m.video_editor_timer_progress_color()}
							value={item.timer.progressColor ?? item.color ?? '#ffffff'}
							live={false}
							onChange={(progressColor) => update({ progressColor })}
						/>
					</div>
					<div class="grid gap-1 text-xs">
						<span>{m.video_editor_timer_track_color()}</span>
						<ColorPicker
							label={m.video_editor_timer_track_color()}
							value={item.timer.trackColor ?? item.timer.progressColor ?? item.color ?? '#ffffff'}
							live={false}
							onChange={(trackColor) => update({ trackColor })}
						/>
					</div>
					<label class="grid gap-1 text-xs"
						>{m.video_editor_timer_track_opacity()}<Input
							type="number"
							min={0}
							max={100}
							step={1}
							value={(item.timer.trackOpacity ?? 0.2) * 100}
							onchange={(event) =>
								update({
									trackOpacity:
										Math.max(0, Math.min(100, event.currentTarget.valueAsNumber || 0)) / 100
								})}
						/></label
					>
					<label class="grid gap-1 text-xs"
						>{m.video_editor_timer_thickness()}<Input
							type="number"
							min={1}
							max={25}
							step={0.5}
							value={item.timer.thickness ?? (item.timer.style === 'bar' ? 8 : 3.5)}
							onchange={(event) =>
								update({
									thickness: Math.max(1, Math.min(25, event.currentTarget.valueAsNumber || 1))
								})}
						/></label
					>
					<label class="grid gap-1 text-xs"
						>{m.video_editor_timer_segments()}<Input
							type="number"
							min={1}
							max={60}
							step={1}
							value={item.timer.segments ?? 1}
							onchange={(event) =>
								update({
									segments: Math.max(
										1,
										Math.min(60, Math.round(event.currentTarget.valueAsNumber || 1))
									)
								})}
						/></label
					>
					{#if item.timer.style === 'ring'}
						<label class="grid gap-1 text-xs"
							>{m.video_editor_timer_start_angle()}<Input
								type="number"
								min={-360}
								max={360}
								step={1}
								value={item.timer.startAngle ?? -90}
								onchange={(event) =>
									update({
										startAngle: Math.max(
											-360,
											Math.min(360, event.currentTarget.valueAsNumber || 0)
										)
									})}
							/></label
						>
					{/if}
					<label class="flex items-center gap-2 text-xs [@media(pointer:coarse)]:min-h-11"
						><Checkbox
							checked={item.timer.rounded !== false}
							onCheckedChange={(rounded) => update({ rounded })}
						/>{m.video_editor_camera_rounded()}</label
					>
				{:else if item.timer.style === 'bomb' || item.timer.style === 'tomato'}
					<div class="grid gap-1 text-xs">
						<span>{m.video_editor_timer_body_color()}</span>
						<ColorPicker
							label={m.video_editor_timer_body_color()}
							value={item.timer.bodyColor ??
								(item.timer.style === 'tomato' ? '#e94025' : '#35404e')}
							live={false}
							onChange={(bodyColor) => update({ bodyColor })}
						/>
					</div>
					<div class="grid gap-1 text-xs">
						<span>{m.video_editor_timer_accent_color()}</span>
						<ColorPicker
							label={m.video_editor_timer_accent_color()}
							value={item.timer.accentColor ??
								(item.timer.style === 'tomato' ? '#498632' : '#ffc454')}
							live={false}
							onChange={(accentColor) => update({ accentColor })}
						/>
					</div>
					<label class="flex items-center gap-2 text-xs [@media(pointer:coarse)]:min-h-11"
						><Checkbox
							checked={item.timer.finishEffect !== false}
							onCheckedChange={(finishEffect) => update({ finishEffect })}
						/>{m.video_editor_timer_finish_effect()}</label
					>
				{/if}
				<Button
					size="xs"
					variant="ghost"
					onclick={() =>
						update({
							progressColor: undefined,
							trackColor: undefined,
							trackOpacity: undefined,
							thickness: undefined,
							segments: undefined,
							startAngle: undefined,
							rounded: undefined,
							showValue: undefined,
							bodyColor: undefined,
							accentColor: undefined,
							finishEffect: undefined
						})}>{m.video_editor_settings_reset()}</Button
				>
			</div>
		</Disclosure>
	</section>
{/if}
