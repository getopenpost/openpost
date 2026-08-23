export const PREVIEW_ZOOM_PRESETS = [-1, 0.25, 0.5, 0.75, 1] as const;

export function normalizePreviewZoom(value: number): number {
	if (value === -1) return -1;
	if (!Number.isFinite(value)) return -1;
	return Math.min(2, Math.max(0.1, Number(value.toFixed(2))));
}

export function zoomPreview(value: number, direction: 'in' | 'out'): number {
	const current = value === -1 ? 1 : normalizePreviewZoom(value);
	return normalizePreviewZoom(direction === 'in' ? current * 1.2 : current / 1.2);
}

export function clampMonitorVolume(value: number): number {
	if (!Number.isFinite(value)) return 1;
	return Math.min(1, Math.max(0, value));
}

export function previewItemVolume(
	item: Pick<TimelineItem, 'trackId' | 'volume'>,
	tracks: Array<Pick<TimelineTrack, 'id' | 'muted' | 'solo' | 'volume' | 'visible'>>,
	monitorVolume: number,
	monitorMuted: boolean
): number {
	if (monitorMuted) return 0;
	const track = tracks.find((candidate) => candidate.id === item.trackId);
	if (!track || track.muted || track.visible === false) return 0;
	const anySolo = tracks.some((candidate) => candidate.solo);
	if (anySolo && !track.solo) return 0;
	return clampMonitorVolume((item.volume ?? 1) * (track.volume ?? 1) * monitorVolume);
}

export function previewItemVolumeWithFade(baseGain: number, crossfadeGain: number): number {
	return clampMonitorVolume(baseGain * crossfadeGain);
}

export function buildFrameFileName(frame: number, fps: number, totalFrames: number): string {
	const safeFrame = Math.max(0, Math.round(frame));
	const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
	const frameDigits = Math.max(String(Math.max(0, totalFrames - 1)).length, 1);
	const totalSeconds = safeFrame / safeFps;
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = Math.floor(totalSeconds % 60);
	const frames = Math.floor(safeFrame % safeFps);
	const timecode = [hours, minutes, seconds, frames]
		.map((part) => String(part).padStart(2, '0'))
		.join('-');
	return `frame-${String(safeFrame).padStart(frameDigits, '0')}-${timecode}.png`;
}
import type { TimelineItem, TimelineTrack } from '../project/types';
