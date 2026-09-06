/** Decode exact upcoming preview frames away from the UI thread. */
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';

export interface DecoderPrewarmDecodeRequest {
	type: 'decode';
	requestId: string;
	sourceKey: string;
	blob: Blob;
	timestamps: number[];
	maxHeight: number;
}

export interface DecoderPrewarmWarmRequest {
	type: 'warm';
	requestId: string;
}

export type DecoderPrewarmWorkerRequest = DecoderPrewarmDecodeRequest | DecoderPrewarmWarmRequest;

export type DecoderPrewarmWorkerResponse =
	| { type: 'warmed'; requestId: string }
	| {
			type: 'decoded';
			requestId: string;
			entries: Array<{ timestamp: number; bitmap: ImageBitmap }>;
	  }
	| { type: 'error'; requestId: string; error: string };

let source:
	| {
			key: string;
			input: Input;
			sink: CanvasSink;
	  }
	| undefined;

function disposeSource(): void {
	source?.input.dispose();
	source = undefined;
}

async function decoderFor(request: DecoderPrewarmDecodeRequest): Promise<CanvasSink> {
	if (source?.key === request.sourceKey) return source.sink;
	disposeSource();
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(request.blob) });
	try {
		const track = await input.getPrimaryVideoTrack();
		if (!track) throw new Error('No video track found.');
		if (!(await track.canDecode())) throw new Error('The browser cannot decode this video track.');
		const [squareWidth, squareHeight, rotation] = await Promise.all([
			track.getSquarePixelWidth(),
			track.getSquarePixelHeight(),
			track.getRotation()
		]);
		const rotated = Math.abs(Math.round(rotation / 90)) % 2 === 1;
		const displayWidth = rotated ? squareHeight : squareWidth;
		const displayHeight = rotated ? squareWidth : squareHeight;
		const scale = Math.min(1, request.maxHeight / Math.max(1, displayHeight));
		const sink = new CanvasSink(track, {
			width: Math.max(2, Math.round(displayWidth * scale)),
			height: Math.max(2, Math.round(displayHeight * scale)),
			fit: 'fill',
			poolSize: 2
		});
		source = { key: request.sourceKey, input, sink };
		return sink;
	} catch (error) {
		input.dispose();
		throw error;
	}
}

async function decode(request: DecoderPrewarmDecodeRequest): Promise<void> {
	const sink = await decoderFor(request);
	const timestamps = [...new Set(request.timestamps)]
		.filter((timestamp) => Number.isFinite(timestamp) && timestamp >= 0)
		.sort((a, b) => a - b);
	async function* requestedTimestamps(): AsyncGenerator<number> {
		for (const timestamp of timestamps) yield timestamp;
	}
	const entries: Array<{ timestamp: number; bitmap: ImageBitmap }> = [];
	let index = 0;
	for await (const wrapped of sink.canvasesAtTimestamps(requestedTimestamps())) {
		const timestamp = timestamps[index++];
		if (timestamp === undefined || !wrapped) continue;
		entries.push({ timestamp, bitmap: await createImageBitmap(wrapped.canvas) });
	}
	self.postMessage(
		{
			type: 'decoded',
			requestId: request.requestId,
			entries
		} satisfies DecoderPrewarmWorkerResponse,
		{ transfer: entries.map((entry) => entry.bitmap) }
	);
}

self.onmessage = async (event: MessageEvent<DecoderPrewarmWorkerRequest>) => {
	const request = event.data;
	try {
		if (request.type === 'warm') {
			self.postMessage({
				type: 'warmed',
				requestId: request.requestId
			} satisfies DecoderPrewarmWorkerResponse);
			return;
		}
		await decode(request);
	} catch (error) {
		self.postMessage({
			type: 'error',
			requestId: request.requestId,
			error: error instanceof Error ? error.message : String(error)
		} satisfies DecoderPrewarmWorkerResponse);
	}
};

export {};
