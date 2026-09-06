import { editorSession } from '../editor.svelte';
import type { Clock } from './clock';

export interface ShuttleScrubResume {
	readonly hasSaved: boolean;
	begin(): void;
	commit(): void;
	cancel(): void;
	reset(): void;
}

export function createShuttleScrubResume(clock: Clock): ShuttleScrubResume {
	let savedRate: number | null = $state(null);
	let savedWasPlaying = $state(false);

	return {
		get hasSaved(): boolean {
			return savedRate !== null;
		},
		begin(): void {
			if (clock.isPlaying) {
				savedRate = clock.playbackRate;
				savedWasPlaying = true;
				clock.pause();
			} else {
				savedRate = null;
				savedWasPlaying = false;
			}
		},
		commit(): void {
			if (savedRate !== null && savedWasPlaying) {
				const rate = savedRate;
				savedRate = null;
				savedWasPlaying = false;
				clock.setRate(rate);
				clock.play();
			} else {
				savedRate = null;
				savedWasPlaying = false;
			}
		},
		cancel(): void {
			savedRate = null;
			savedWasPlaying = false;
		},
		reset(): void {
			savedRate = null;
			savedWasPlaying = false;
		}
	};
}

export const shuttleScrubResume: ShuttleScrubResume = createShuttleScrubResume(editorSession.clock);
