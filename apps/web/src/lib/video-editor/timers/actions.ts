import { effectiveMediaTracks } from '../timeline/utils/track-groups';
import { trackRangeIsOpen } from '../timeline/track-occupancy';
import { execute } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { ensureOpenTrackForRange } from '../timeline/actions/track-placement';
import type { TimerSettings } from './timer';

export function addTimer(
	settings: TimerSettings,
	label: string,
	placement?: { from: number; trackId: string }
): string {
	return execute('ADD_TIMER', () => {
		const from = placement?.from ?? timelineStore.currentFrame;
		const durationInFrames = Math.round(
			timelineStore.fps * (10 + (settings.finishHoldSeconds ?? 0))
		);
		if (placement) {
			const target = effectiveMediaTracks(timelineStore.tracks).find(
				(track) => track.id === placement.trackId
			);
			if (
				!target ||
				target.locked ||
				target.kind !== 'video' ||
				!trackRangeIsOpen(timelineStore.items, target.id, from, durationInFrames, 'text')
			)
				throw new Error('The drop position is no longer available.');
		}
		const track = ensureOpenTrackForRange({
			kind: 'video',
			itemType: 'text',
			from,
			durationInFrames,
			label,
			preferredTrackId: placement?.trackId
		});
		const id = crypto.randomUUID();
		timelineStore._addItem({
			id,
			trackId: track.id,
			type: 'text',
			label,
			from,
			durationInFrames,
			timer: { ...settings },
			text: '00:10',
			fontFamily: 'sans-serif',
			fontSize: 72,
			fontWeight: 700,
			color: '#ffffff',
			textAlign: 'center',
			verticalAlign: 'middle',
			transform: { width: 420, height: 420, x: 0, y: 0 }
		});
		return id;
	});
}
