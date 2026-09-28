/// <reference lib="webworker" />

export type ScratchWriteRequest =
	| { id: number; type: 'open'; handle: FileSystemFileHandle }
	| { id: number; type: 'write'; chunk: Blob }
	| { id: number; type: 'close' };

export type ScratchWriteResponse = {
	id: number;
	error?: { name: string; message: string };
};

let handle: FileSystemSyncAccessHandle | null = null;
let offset = 0;
let failure: Error | null = null;
let queue: Promise<void> = Promise.resolve();

async function execute(request: ScratchWriteRequest): Promise<void> {
	if (request.type === 'open') {
		handle = await request.handle.createSyncAccessHandle();
		offset = handle.getSize();
		return;
	}
	if (request.type === 'close') {
		handle?.close();
		handle = null;
		return;
	}
	if (failure) throw failure;
	if (!handle) throw new Error('Recording storage is closed');
	const bytes = new Uint8Array(await request.chunk.arrayBuffer());
	try {
		let written = 0;
		while (written < bytes.length) {
			const count = handle.write(bytes.subarray(written), {
				at: offset + written
			});
			if (count === 0) throw new DOMException('Recording storage is full', 'QuotaExceededError');
			written += count;
		}
		// Acknowledgement means this chunk survives a lost tab, not just a worker buffer.
		handle.flush();
		offset += written;
	} catch (error) {
		failure = error instanceof Error ? error : new Error(String(error));
		// Retain only the last acknowledged prefix if an append was partial.
		handle.truncate(offset);
		handle.flush();
		throw failure;
	}
}

self.onmessage = (event: MessageEvent<ScratchWriteRequest>) => {
	const request = event.data;
	queue = queue.then(async () => {
		const response: ScratchWriteResponse = { id: request.id };
		try {
			await execute(request);
		} catch (error) {
			response.error = {
				name: error instanceof Error ? error.name : 'Error',
				message: error instanceof Error ? error.message : String(error)
			};
		}
		self.postMessage(response);
	});
};
