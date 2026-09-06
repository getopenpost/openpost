import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { ensureProResDecoderForCodec } from './prores-decoder';
import type { TimelineItem } from '../project/types';
import { frameToSourceSeconds } from './render-plan';
import type { MediaMetadata } from './types';
import { resolveMediaBlob } from './import.svelte';

export interface ExtractedFreezeFrame {
	blob: Blob;
	width: number;
	height: number;
	sourceSeconds: number;
}

async function canvasToPng(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Blob> {
	if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/png' });
	return new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error('The decoded frame could not be saved.'))),
			'image/png'
		);
	});
}

/** Decode the exact source frame shown by a clip, at the source's display resolution. */
export async function extractFreezeFrameFromBlob(
	blob: Blob,
	item: TimelineItem,
	playheadFrame: number,
	timelineFps: number
): Promise<ExtractedFreezeFrame> {
	if (item.type !== 'video') throw new Error('Freeze frames require a video clip.');
	if (playheadFrame <= item.from || playheadFrame >= item.from + item.durationInFrames) {
		throw new Error('Place the playhead inside the selected video clip.');
	}

	const sourceSeconds = frameToSourceSeconds(item, playheadFrame, timelineFps);
	const input = new Input({
		source: new BlobSource(blob),
		formats: ALL_FORMATS
	});
	try {
		const track = await input.getPrimaryVideoTrack();
		if (!track) throw new Error('The selected media has no video track.');
		await ensureProResDecoderForCodec(track.codec);
		const width = Math.max(1, Math.round(track.displayWidth));
		const height = Math.max(1, Math.round(track.displayHeight));
		const sink = new CanvasSink(track, { width, height, fit: 'fill' });
		try {
			const wrapped = await sink.getCanvas(sourceSeconds);
			if (!wrapped) throw new Error('The source frame could not be decoded.');
			return {
				blob: await canvasToPng(wrapped.canvas),
				width,
				height,
				sourceSeconds
			};
		} finally {
			// SAFETY: Mediabunny may expose an optional CanvasSink disposer at runtime.
			(sink as CanvasSink & { dispose?: () => void }).dispose?.();
		}
	} finally {
		input.dispose?.();
	}
}

export async function extractFreezeFrame(
	media: MediaMetadata,
	item: TimelineItem,
	playheadFrame: number,
	timelineFps: number
): Promise<ExtractedFreezeFrame> {
	return extractFreezeFrameFromBlob(
		await resolveMediaBlob(media),
		item,
		playheadFrame,
		timelineFps
	);
}
