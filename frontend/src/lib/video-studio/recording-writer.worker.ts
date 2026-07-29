/// <reference lib="webworker" />

type StorageManagerWithDirectory = StorageManager & {
	getDirectory(): Promise<FileSystemDirectoryHandle>;
};

interface OpenTrack {
	writable: FileSystemWritableFileStream;
	position: number;
}

type WriterMessage =
	| { type: 'init'; track_id: string; path: string }
	| { type: 'chunk'; track_id: string; index: number; timestamp_us: number; data: ArrayBuffer }
	| { type: 'close'; track_id: string }
	| { type: 'abort'; track_id: string };

const tracks = new Map<string, OpenTrack>();
let writeQueue = Promise.resolve();

self.onmessage = (event: MessageEvent<WriterMessage>) => {
	writeQueue = writeQueue.then(() => handleMessage(event.data));
};

async function handleMessage(message: WriterMessage): Promise<void> {
	try {
		switch (message.type) {
			case 'init':
				await initializeTrack(message.track_id, message.path);
				postMessage({ type: 'ready', track_id: message.track_id });
				break;
			case 'chunk':
				await writeChunk(message.track_id, message.index, message.timestamp_us, message.data);
				break;
			case 'close':
				await closeTrack(message.track_id);
				postMessage({ type: 'closed', track_id: message.track_id });
				break;
			case 'abort':
				await abortTrack(message.track_id);
				postMessage({ type: 'aborted', track_id: message.track_id });
				break;
		}
	} catch (cause) {
		postMessage({
			type: 'error',
			track_id: message.track_id,
			message: cause instanceof Error ? cause.message : 'Recording write failed.'
		});
	}
}

async function initializeTrack(trackID: string, path: string): Promise<void> {
	const segments = path.split('/').filter(Boolean);
	if (
		segments.length < 4 ||
		segments[0] !== 'openpost-video-studio' ||
		segments[1] !== 'projects' ||
		segments.some((segment) => segment === '..' || segment.includes('\\'))
	) {
		throw new Error('Invalid recording path.');
	}
	const root = await (navigator.storage as StorageManagerWithDirectory).getDirectory();
	let directory = root;
	for (const segment of segments.slice(0, -1)) {
		directory = await directory.getDirectoryHandle(segment, { create: true });
	}
	const handle = await directory.getFileHandle(segments.at(-1)!, { create: true });
	tracks.set(trackID, { writable: await handle.createWritable(), position: 0 });
}

async function writeChunk(
	trackID: string,
	index: number,
	timestampUS: number,
	data: ArrayBuffer
): Promise<void> {
	const track = tracks.get(trackID);
	if (!track) throw new Error('Recording track is not ready.');
	const position = track.position;
	await track.writable.write({ type: 'write', position, data });
	track.position += data.byteLength;
	const checksum = await crypto.subtle.digest('SHA-256', data);
	postMessage({
		type: 'written',
		track_id: trackID,
		index,
		timestamp_us: timestampUS,
		position,
		bytes: data.byteLength,
		checksum: hex(checksum)
	});
}

async function closeTrack(trackID: string): Promise<void> {
	const track = tracks.get(trackID);
	if (!track) return;
	await track.writable.close();
	tracks.delete(trackID);
}

async function abortTrack(trackID: string): Promise<void> {
	const track = tracks.get(trackID);
	if (!track) return;
	await track.writable.abort(new DOMException('Recording aborted', 'AbortError'));
	tracks.delete(trackID);
}

function hex(buffer: ArrayBuffer): string {
	return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export {};
