/** Subtitle export planning shared by sidecar and embedded-track modes. */
import type { SubtitleCue, TimelineItem } from '$lib/video-editor/project/types';
import { formatSrt } from './srt';

export function collectSubtitleCues(
	items: TimelineItem[],
	fps: number,
	startFrame = 0,
	endFrame = Number.POSITIVE_INFINITY
): Array<{ startSeconds: number; endSeconds: number; text: string }> {
	return items
		.filter((item) => item.type === 'subtitle')
		.flatMap((item) => item.cues ?? [])
		.filter((cue) => cue.endFrame > startFrame && cue.startFrame < endFrame)
		.map((cue) => ({
			startSeconds: Math.max(0, Math.max(cue.startFrame, startFrame) - startFrame) / fps,
			endSeconds: Math.max(1, Math.min(cue.endFrame, endFrame) - startFrame) / fps,
			text: cue.text
		}))
		.sort((left, right) => left.startSeconds - right.startSeconds);
}

export function subtitleSidecarSrt(
	items: TimelineItem[],
	fps: number,
	startFrame?: number,
	endFrame?: number
): string {
	return formatSrt(collectSubtitleCues(items, fps, startFrame, endFrame));
}

export function subtitleWebVtt(
	items: TimelineItem[],
	fps: number,
	startFrame?: number,
	endFrame?: number
): string {
	const body = collectSubtitleCues(items, fps, startFrame, endFrame)
		.map(
			(cue) =>
				`${formatVttTime(cue.startSeconds)} --> ${formatVttTime(cue.endSeconds)}\n${cue.text}`
		)
		.join('\n\n');
	return `WEBVTT\n\n${body}\n`;
}

function formatVttTime(secondsValue: number): string {
	const seconds = Math.max(0, secondsValue);
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const wholeSeconds = Math.floor(seconds % 60);
	const milliseconds = Math.round((seconds - Math.floor(seconds)) * 1000);
	return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(wholeSeconds, 2)}.${pad(milliseconds, 3)}`;
}

function pad(value: number, width: number): string {
	return String(value).padStart(width, '0');
}
