import { formatTimelinePreviewTimecode } from '../preview/timeline-preview-scrub';

/** Compact signed timecode used by linked A/V drift badges. */
export function formatLinkedSyncOffset(frameDelta: number, fps: number): string {
	const parts = formatTimelinePreviewTimecode(Math.abs(frameDelta), fps).split(':');
	while (parts.length > 2 && parts[0] === '00') parts.shift();
	return `${frameDelta > 0 ? '+' : '-'}${parts.join(':')}`;
}

/** Keep the badge out of clip shells that cannot hold its full value. */
export function linkedSyncBadgeMinimumWidth(label: string): number {
	return 30 + label.length * 6;
}
