import { StreamingNoiseReduction } from './audio-noise-reduction';

export interface NoiseReductionRequest {
	type: 'process';
	requestId: string;
	sampleRate: number;
	amount: number;
	channelBuffers: ArrayBuffer[];
	channelLengths: number[];
}

export interface NoiseReductionProgressResponse {
	type: 'progress';
	requestId: string;
	progress: number;
}

export interface NoiseReductionCompleteResponse {
	type: 'complete';
	requestId: string;
	channelBuffers: ArrayBuffer[];
	channelLengths: number[];
}

export interface NoiseReductionErrorResponse {
	type: 'error';
	requestId: string;
	error: string;
}

export interface NoiseReductionAbort {
	type: 'abort';
	requestId: string;
}

type WorkerRequest = NoiseReductionRequest | NoiseReductionAbort;

const active = new Map<string, AbortController>();

function completeTransferOptions(buffers: ArrayBuffer[]): StructuredSerializeOptions {
	return { transfer: buffers };
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
	const data = event.data;
	if (data.type === 'abort') {
		active.get(data.requestId)?.abort();
		return;
	}
	if (data.type !== 'process') return;
	const { requestId, sampleRate, amount, channelBuffers, channelLengths } = data;
	const controller = new AbortController();
	active.set(requestId, controller);
	try {
		const channels = channelBuffers.map((ab, i) =>
			new Float32Array(ab).slice(0, channelLengths[i]!)
		);
		const proc = new StreamingNoiseReduction(channels.length, sampleRate, {
			enabled: true,
			amount
		});
		const total = channels[0]?.length ?? 0;
		const windowSize = 120_000;
		let offset = 0;
		const outChannels = channels.map(() => new Float32Array(total));
		while (offset < total) {
			if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
			const len = Math.min(windowSize, total - offset);
			const chunk = channels.map((ch) => ch.slice(offset, offset + len));
			const isLast = offset + len >= total;
			const out = proc.process(chunk, isLast, controller.signal);
			for (let c = 0; c < channels.length; c++) {
				outChannels[c]!.set(out[c]!, offset);
			}
			offset += len;
			const progress = total ? Math.round((offset / total) * 100) : 100;
			self.postMessage({
				type: 'progress',
				requestId,
				progress
			} satisfies NoiseReductionProgressResponse);
		}
		const finalBuffers = outChannels.map((ch) => ch.buffer.slice(0));
		const lengths = outChannels.map((ch) => ch.length);
		self.postMessage(
			{
				type: 'complete',
				requestId,
				channelBuffers: finalBuffers,
				channelLengths: lengths
			} satisfies NoiseReductionCompleteResponse,
			completeTransferOptions(finalBuffers)
		);
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') return;
		self.postMessage({
			type: 'error',
			requestId,
			error: error instanceof Error ? error.message : String(error)
		} satisfies NoiseReductionErrorResponse);
	} finally {
		active.delete(requestId);
	}
};
