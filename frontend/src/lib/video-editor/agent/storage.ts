export const AGENT_MODEL_ID = 'onnx-community/gemma-3n-E2B-it-ONNX';
export const AGENT_EXPECTED_BYTES = 3_200_000_000;
const HEADROOM_BYTES = 512_000_000;
const TRANSFORMERS_CACHE_NAME = 'transformers-cache';

export interface AgentStorageStatus {
	expectedBytes: number;
	readyBytes: number;
	missingBytes: number;
	headroomBytes: number;
	availableBytes?: number;
	effectiveAvailableBytes?: number;
	sufficient: boolean;
	persisted?: boolean;
	sizeStatus: 'exact' | 'partial' | 'unknown';
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs = 1500): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
			})
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

export async function inspectAgentStorage(): Promise<AgentStorageStatus> {
	let availableBytes: number | undefined;
	let persisted: boolean | undefined;
	try {
		if ('storage' in navigator) {
			if ('persist' in navigator.storage) {
				try {
					persisted = await (
						navigator.storage as unknown as { persist: () => Promise<boolean> }
					).persist();
				} catch {
					persisted = undefined;
				}
			}
			if ('estimate' in navigator.storage) {
				const estimate = await (
					navigator.storage as unknown as {
						estimate: () => Promise<{ quota?: number; usage?: number }>;
					}
				).estimate();
				if (estimate.quota !== undefined && estimate.usage !== undefined) {
					availableBytes = Math.max(0, estimate.quota - estimate.usage);
				}
			}
		}
	} catch {
		// ignore
	}

	let readyBytes = 0;
	let sizeStatus: AgentStorageStatus['sizeStatus'] = 'unknown';
	let entryCount = 0;
	let measured = 0;
	try {
		if ('caches' in globalThis) {
			const cache = await withTimeout(caches.open(TRANSFORMERS_CACHE_NAME), 1500);
			const requests = await withTimeout(cache.keys(), 1500);
			const gemmaRequests = requests.filter((request) =>
				request.url.toLowerCase().includes('gemma-3n')
			);
			entryCount = gemmaRequests.length;
			if (entryCount === 0) {
				sizeStatus = 'unknown';
				readyBytes = 0;
			} else {
				const sizes = await Promise.allSettled(
					gemmaRequests.map(async (request) => {
						const response = await withTimeout(
							cache.match(request) as Promise<Response | undefined>,
							300
						);
						const raw = response?.headers.get('content-length');
						const size = raw ? Number(raw) : Number.NaN;
						return Number.isFinite(size) && size >= 0 ? size : null;
					})
				);
				for (const result of sizes) {
					if (result.status === 'fulfilled' && result.value !== null) {
						readyBytes += result.value;
						measured += 1;
					}
				}
				if (measured === 0) {
					sizeStatus = 'unknown';
					readyBytes = 0;
				} else if (measured === entryCount) {
					sizeStatus = 'exact';
				} else {
					sizeStatus = 'partial';
				}
				readyBytes = Math.min(readyBytes, AGENT_EXPECTED_BYTES);
			}
		}
	} catch {
		readyBytes = 0;
		sizeStatus = 'unknown';
	}

	const missingBytes =
		sizeStatus === 'unknown'
			? AGENT_EXPECTED_BYTES
			: Math.max(0, AGENT_EXPECTED_BYTES - readyBytes);
	const headroomBytes = missingBytes > 0 ? HEADROOM_BYTES : 0;
	const effectiveAvailableBytes = availableBytes;
	const sufficient =
		effectiveAvailableBytes === undefined ||
		effectiveAvailableBytes >= missingBytes + headroomBytes;

	return {
		expectedBytes: AGENT_EXPECTED_BYTES,
		readyBytes: sizeStatus === 'unknown' ? 0 : readyBytes,
		missingBytes,
		headroomBytes,
		availableBytes,
		effectiveAvailableBytes,
		sufficient,
		persisted,
		sizeStatus
	};
}
