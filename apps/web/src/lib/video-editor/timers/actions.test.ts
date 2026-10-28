import { expect, it } from 'vitest';
import { createDefaultTracks } from '../project/defaults';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { addTimer } from './actions';
import type { TimerSettings } from './timer';

const timer: TimerSettings = {
	style: 'ring',
	direction: 'down',
	format: 'clock'
};

it('adds a timer above an occupied video instead of hiding it on an empty lower track', () => {
	timelineStore.__resetForTesting();
	const tracks = createDefaultTracks();
	timelineStore._setTracks(tracks);
	commandHistory.clearHistory();
	const top = tracks
		.filter((track) => track.kind === 'video')
		.sort((left, right) => left.order - right.order)[0]!;
	timelineStore._setItems([
		{
			id: 'clip',
			trackId: top.id,
			from: 0,
			durationInFrames: 300,
			label: 'Clip',
			type: 'video'
		}
	]);
	const id = addTimer(timer, 'Timer');
	const item = timelineStore.itemById.get(id)!;
	expect(timelineStore.tracks.find((track) => track.id === item.trackId)!.order).toBeLessThan(
		top.order
	);
});
