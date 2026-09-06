/**
 * SRT parsing and serialization for caption import and export sidecars.
 * VTT shares the timestamp grammar minus the counter/index line; the parser
 * accepts both and the writer emits SRT.
 */

export interface SrtCue {
	startSeconds: number;
	endSeconds: number;
	text: string;
}

function parseTimestamp(raw: string): number | null {
	const value = raw.trim();
	const full = value.match(/^(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})$/);
	if (full) {
		const [, h, m, s, ms] = full;
		return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms!.padEnd(3, '0')) / 1000;
	}
	// VTT also allows MM:SS.mmm
	const short = value.match(/^(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
	if (short) {
		const [, m, s, ms] = short;
		return Number(m) * 60 + Number(s) + Number(ms!.padEnd(3, '0')) / 1000;
	}
	return null;
}

function formatTimestamp(totalSeconds: number): string {
	const clamped = Math.max(0, totalSeconds);
	const hours = Math.floor(clamped / 3600);
	const minutes = Math.floor((clamped % 3600) / 60);
	const seconds = Math.floor(clamped % 60);
	const millis = Math.round((clamped - Math.floor(clamped)) * 1000);
	const pad = (value: number, width: number): string => String(value).padStart(width, '0');
	return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(millis, 3)}`;
}

export function parseSrt(content: string): SrtCue[] {
	const cues: SrtCue[] = [];
	for (const block of content
		.replace(/\r\n/g, '\n')
		.trim()
		.split(/\n{2,}/)) {
		const lines = block.split('\n').filter((line) => line.trim() !== '');
		const timingLine = lines.find((line) => line.includes('-->'));
		if (!timingLine) continue;
		const [rawStart, rawEnd] = timingLine.split('-->');
		if (!rawStart || !rawEnd) continue;
		// VTT appends cue settings after the end timestamp; keep the token only.
		const startSeconds = parseTimestamp(rawStart.trim().split(/\s/)[0]!);
		const endSeconds = parseTimestamp(rawEnd.trim().split(/\s/)[0]!);
		if (startSeconds === null || endSeconds === null) continue;
		const textLines = lines.filter((line) => line !== timingLine && !/^\d+$/.test(line.trim()));
		if (textLines.length === 0) continue;
		cues.push({ startSeconds, endSeconds, text: textLines.join('\n') });
	}
	return cues.sort((a, b) => a.startSeconds - b.startSeconds);
}

export function formatSrt(
	cues: Array<{ startSeconds: number; endSeconds: number; text: string }>
): string {
	return cues
		.map(
			(cue, index) =>
				`${index + 1}\n${formatTimestamp(cue.startSeconds)} --> ${formatTimestamp(cue.endSeconds)}\n${cue.text}`
		)
		.join('\n\n');
}
