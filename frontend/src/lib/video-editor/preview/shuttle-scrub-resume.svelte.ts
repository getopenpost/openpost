import { editorSession } from '../editor.svelte';

let savedRate: number | null = $state(null);
let savedWasPlaying = $state(false);

export const shuttleScrubResume = {
	get hasSaved(): boolean {
		return savedRate !== null;
	},
	begin(): void {
		if (editorSession.clock.isPlaying) {
			savedRate = editorSession.clock.playbackRate;
			savedWasPlaying = true;
			editorSession.clock.pause();
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
			editorSession.clock.setRate(rate);
			const maxEnd = 1;
			// Resume playback; caller should provide range if needed, but clock retains range
			// Use stored resume range via play without options
			editorSession.clock.play();
			// Ensure rate is restored after play (play may reset anchor)
			editorSession.clock.setRate(rate);
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
