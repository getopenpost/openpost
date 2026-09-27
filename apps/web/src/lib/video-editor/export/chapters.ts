import type { TimelineMarker } from '../project/types';

/** Chapter times are relative to the rendered range, in whole seconds. */
export function chaptersFromMarkers(
	markers: readonly TimelineMarker[],
	fps: number,
	range: { startFrame: number; endFrame: number }
): string {
	if (!Number.isFinite(fps) || fps <= 0 || range.endFrame <= range.startFrame) return '';
	const named = markers
		.filter((marker) => !marker.kind && marker.label?.trim() && Number.isFinite(marker.frame))
		.toSorted((a, b) => a.frame - b.frame);
	const entries = new Map<number, string>();
	// Preserve the chapter already in progress when exporting a selection.
	const preceding = named.findLast((marker) => marker.frame <= range.startFrame);
	if (preceding) entries.set(0, preceding.label!.trim().replace(/\s+/gu, ' '));
	for (const marker of named) {
		if (marker.frame < range.startFrame || marker.frame >= range.endFrame) continue;
		const seconds = Math.floor((marker.frame - range.startFrame) / fps);
		if (!entries.has(seconds)) entries.set(seconds, marker.label!.trim().replace(/\s+/gu, ' '));
	}
	return [...entries]
		.map(([seconds, title]) => {
			const hours = Math.floor(seconds / 3600);
			const minutes = Math.floor(seconds / 60) % 60;
			const time = `${hours ? `${hours}:` : ''}${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
			return `${time} ${title}`;
		})
		.join('\n');
}
