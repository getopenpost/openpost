import { m } from '$lib/paraglide/messages';
import type { TimerSettings } from './timer';
export function videoTimerPresets(): Array<{ name: string; timer: TimerSettings }> {
	return [
		{
			name: m.video_editor_timer_down(),
			timer: { finishHoldSeconds: 0.5, style: 'numbers', direction: 'down', format: 'seconds' }
		},
		{
			name: m.video_editor_timer_ring(),
			timer: { finishHoldSeconds: 0.5, style: 'ring', direction: 'down', format: 'clock' }
		},
		{
			name: m.video_editor_timer_bar(),
			timer: { finishHoldSeconds: 0.5, style: 'bar', direction: 'up', format: 'percent' }
		},
		{
			name: m.video_editor_timer_up(),
			timer: { finishHoldSeconds: 0.5, style: 'numbers', direction: 'up', format: 'clock' }
		},
		{
			name: m.video_editor_timer_bomb(),
			timer: { finishHoldSeconds: 0.5, style: 'bomb', direction: 'down', format: 'seconds' }
		},
		{
			name: m.video_editor_timer_tomato(),
			timer: { finishHoldSeconds: 0.5, style: 'tomato', direction: 'down', format: 'clock' }
		}
	];
}
