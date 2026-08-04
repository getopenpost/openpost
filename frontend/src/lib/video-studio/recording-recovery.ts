import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from 'mediabunny';
import { readProjectFile, writeProjectStream } from './storage';
import type { RecordingChunkManifest, RecordingManifest, RecordingTrackManifest } from './types';

export interface RecordingRecoveryResult {
	manifest: RecordingManifest;
	recovered_duration_us: number;
	lost_duration_us: number;
	discarded_chunks: number;
}

export async function recoverVerifiedRecording(
	input: RecordingManifest,
	signal?: AbortSignal
): Promise<RecordingRecoveryResult> {
	const manifest = structuredClone(input);
	manifest.state = 'recoverable';
	manifest.finalization_state = 'recoverable';
	let recoveredDurationUS = 0;
	let originalDurationUS = 0;
	let discardedChunks = 0;
	const recoveredTracks: RecordingTrackManifest[] = [];

	for (const track of manifest.tracks) {
		signal?.throwIfAborted();
		originalDurationUS = Math.max(originalDurationUS, track.duration_us);
		const file = await readProjectFile(track.path);
		if (!file) continue;
		let chunks = await verifyContiguousRecordingChunks(file, track.chunks, signal);
		discardedChunks += track.chunks.length - chunks.length;
		while (chunks.length > 0) {
			signal?.throwIfAborted();
			const end = chunkEnd(chunks.at(-1)!);
			if (await isDecodableRecording(file.slice(0, end), track.kind)) break;
			chunks = chunks.slice(0, -1);
			discardedChunks += 1;
		}
		if (chunks.length === 0) continue;
		const verifiedBytes = chunkEnd(chunks.at(-1)!);
		const recoveredName = `recovered-${track.id}-${crypto.randomUUID()}.webm`;
		const written = await writeProjectStream(
			manifest.project_id,
			'recordings',
			recoveredName,
			file.slice(0, verifiedBytes).stream(),
			{ expectedSize: verifiedBytes, signal }
		);
		const durationUS = Math.max(...chunks.map((chunk) => chunk.media_end_us), 0);
		const path = written.path;
		const segment = track.segments[0]
			? {
					...track.segments[0],
					path,
					session_end_us: track.session_start_offset_us + durationUS,
					media_end_us: durationUS,
					reason_started: 'recovery' as const,
					reason_ended: 'device-loss' as const
				}
			: {
					id: `${track.id}:recovered`,
					path,
					mime_type: track.mime_type,
					session_start_us: track.session_start_offset_us,
					session_end_us: track.session_start_offset_us + durationUS,
					media_start_us: 0,
					media_end_us: durationUS,
					reason_started: 'recovery' as const,
					reason_ended: 'device-loss' as const
				};
		recoveredTracks.push({
			...track,
			path,
			duration_us: durationUS,
			bytes_written: verifiedBytes,
			verified_byte_length: verifiedBytes,
			last_chunk_index: chunks.at(-1)!.index,
			last_chunk_timestamp_us: chunks.at(-1)!.session_end_us,
			chunks,
			segments: [segment],
			state: 'interrupted',
			error: undefined
		});
		recoveredDurationUS = Math.max(recoveredDurationUS, durationUS);
	}

	if (recoveredTracks.length === 0) {
		throw new Error('No verified, decodable recording data could be recovered.');
	}
	manifest.tracks = recoveredTracks;
	manifest.updated_at = new Date().toISOString();
	return {
		manifest,
		recovered_duration_us: recoveredDurationUS,
		lost_duration_us: Math.max(0, originalDurationUS - recoveredDurationUS),
		discarded_chunks: discardedChunks
	};
}

export async function verifyContiguousRecordingChunks(
	file: File,
	chunks: RecordingChunkManifest[],
	signal?: AbortSignal
): Promise<RecordingChunkManifest[]> {
	const verified: RecordingChunkManifest[] = [];
	let expectedPosition = 0;
	for (const chunk of [...chunks].sort((left, right) => left.index - right.index)) {
		signal?.throwIfAborted();
		if (
			chunk.position !== expectedPosition ||
			chunk.size_bytes <= 0 ||
			chunkEnd(chunk) > file.size
		) {
			break;
		}
		const digest = await crypto.subtle.digest(
			'SHA-256',
			await file.slice(chunk.position, chunkEnd(chunk)).arrayBuffer()
		);
		if (hex(digest) !== chunk.sha256.toLowerCase()) break;
		verified.push(chunk);
		expectedPosition = chunkEnd(chunk);
	}
	return verified;
}

async function isDecodableRecording(
	blob: Blob,
	kind: RecordingTrackManifest['kind']
): Promise<boolean> {
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
	try {
		if (!(await input.canRead())) return false;
		const duration = await input.computeDuration();
		if (!Number.isFinite(duration) || duration <= 0) return false;
		if (kind === 'screen' || kind === 'camera') {
			const track = await input.getPrimaryVideoTrack();
			if (!track) return false;
			const sample = await new VideoSampleSink(track, { optimizeForLatency: true }).getSample(0);
			if (!sample) return false;
			sample.close();
			return true;
		}
		return Boolean(await input.getPrimaryAudioTrack());
	} catch {
		return false;
	} finally {
		if (!input.disposed) input.dispose();
	}
}

function chunkEnd(chunk: RecordingChunkManifest): number {
	return chunk.position + chunk.size_bytes;
}

function hex(buffer: ArrayBuffer): string {
	return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
