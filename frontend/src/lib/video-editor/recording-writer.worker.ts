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
	| {
			type: 'chunk';
			track_id: string;
			index: number;
			timestamp_us: number;
			media_start_us: number;
			media_end_us: number;
			session_start_us: number;
			session_end_us: number;
			flush_sequence: number;
			data: ArrayBuffer;
	  }
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
				await writeChunk(message);
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
		segments[0] !== 'openpost-video-editor' ||
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

async function writeChunk(message: Extract<WriterMessage, { type: 'chunk' }>): Promise<void> {
	const track = tracks.get(message.track_id);
	if (!track) throw new Error('Recording track is not ready.');
	const position = track.position;
	await track.writable.write({ type: 'write', position, data: message.data });
	track.position += message.data.byteLength;
	const checksum = await crypto.subtle.digest('SHA-256', message.data);
	postMessage({
		type: 'written',
		track_id: message.track_id,
		index: message.index,
		timestamp_us: message.timestamp_us,
		position,
		bytes: message.data.byteLength,
		media_start_us: message.media_start_us,
		media_end_us: message.media_end_us,
		session_start_us: message.session_start_us,
		session_end_us: message.session_end_us,
		flush_sequence: message.flush_sequence,
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
