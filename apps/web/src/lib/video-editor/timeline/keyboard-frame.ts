/**
 * Pure frame-step map shared by the timeline keyboard sliders (composition
 * ruler, Color mini-timeline). Arrows step one frame (ten with shift),
 * PageUp/PageDown jump one second of frames, and Home/End jump to the
 * timeline bounds. Returns null for unhandled keys so callers can ignore
 * them without side effects.
 */
export function nextKeyboardFrame(
	currentFrame: number,
	key: string,
	shiftKey: boolean,
	fps: number,
	maxFrame: number
): number | null {
	if (key === 'ArrowLeft') return currentFrame - (shiftKey ? 10 : 1);
	if (key === 'ArrowRight') return currentFrame + (shiftKey ? 10 : 1);
	if (key === 'PageDown') return currentFrame - Math.max(1, Math.round(fps));
	if (key === 'PageUp') return currentFrame + Math.max(1, Math.round(fps));
	if (key === 'Home') return 0;
	if (key === 'End') return maxFrame;
	return null;
}
