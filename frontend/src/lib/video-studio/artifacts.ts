import {
	ALL_FORMATS,
	AudioBufferSink,
	BlobSource,
	EncodedPacketSink,
	Input,
	VideoSampleSink
} from 'mediabunny';
import type { VideoSource } from '@openpost/video-project';
import { indexProjectAsset, readProjectFile, writeProjectFile } from './storage';

const ARTIFACT_VERSION = 1;
const WAVEFORM_BUCKETS = 720;
const MAX_KEYFRAMES = 4_000;

export interface SourceArtifactIndex {
	version: number;
	source_id: string;
	duration_us: number;
	keyframes_us: number[];
	waveform_peaks: number[];
}

export async function ensureSourceArtifacts(
	projectID: string,
	source: VideoSource,
	signal?: AbortSignal
): Promise<SourceArtifactIndex | null> {
	if (source.locator.type !== 'local-opfs' || source.kind === 'image') return null;
	const file = await readProjectFile(source.locator.path);
	if (!file) return null;
	signal?.throwIfAborted();
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
	try {
		const [videoTrack, audioTrack] = await Promise.all([
			input.getPrimaryVideoTrack(),
			input.getPrimaryAudioTrack()
		]);
		const [keyframesUS, waveformPeaks] = await Promise.all([
			videoTrack
				? indexKeyframes(new EncodedPacketSink(videoTrack), signal)
				: Promise.resolve<number[]>([]),
			audioTrack && (await audioTrack.canDecode())
				? generateWaveformPeaks(
						new AudioBufferSink(audioTrack),
						source.duration_us,
						WAVEFORM_BUCKETS,
						signal
					)
				: Promise.resolve<number[]>([])
		]);
		if (videoTrack && (await videoTrack.canDecode())) {
			await generateThumbnail(projectID, source, new VideoSampleSink(videoTrack), signal);
		}
		const artifact: SourceArtifactIndex = {
			version: ARTIFACT_VERSION,
			source_id: source.id,
			duration_us: source.duration_us,
			keyframes_us: keyframesUS,
			waveform_peaks: waveformPeaks
		};
		const encoded = new TextEncoder().encode(JSON.stringify(artifact));
		const stored = await writeProjectFile(
			projectID,
			'analysis',
			`${source.id}-source-index-v${ARTIFACT_VERSION}.json`,
			encoded
		);
		await indexDisposableAsset(
			projectID,
			source.id,
			'analysis',
			stored.path,
			stored.size,
			`source-index-v${ARTIFACT_VERSION}`
		);
		if (waveformPeaks.length) {
			const waveform = new TextEncoder().encode(JSON.stringify(waveformPeaks));
			const savedWaveform = await writeProjectFile(
				projectID,
				'waveforms',
				`${source.id}-waveform-v${ARTIFACT_VERSION}.json`,
				waveform
			);
			await indexDisposableAsset(
				projectID,
				source.id,
				'waveform',
				savedWaveform.path,
				savedWaveform.size,
				`waveform-v${ARTIFACT_VERSION}`
			);
		}
		return artifact;
	} finally {
		if (!input.disposed) input.dispose();
	}
}

export async function generateWaveformPeaks(
	sink: AudioBufferSink,
	durationUS: number,
	bucketCount = WAVEFORM_BUCKETS,
	signal?: AbortSignal
): Promise<number[]> {
	const peaks = new Float32Array(Math.max(1, bucketCount));
	const durationSeconds = Math.max(0.001, durationUS / 1_000_000);
	for await (const wrapped of sink.buffers()) {
		signal?.throwIfAborted();
		const buffer = wrapped.buffer;
		for (let frame = 0; frame < buffer.length; frame++) {
			const timestamp = wrapped.timestamp + frame / buffer.sampleRate;
			const bucket = Math.min(
				peaks.length - 1,
				Math.floor((timestamp / durationSeconds) * peaks.length)
			);
			let peak = 0;
			for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
				peak = Math.max(peak, Math.abs(buffer.getChannelData(channel)[frame] ?? 0));
			}
			peaks[bucket] = Math.max(peaks[bucket] ?? 0, peak);
		}
	}
	return Array.from(peaks, (peak) => Math.round(Math.min(1, peak) * 1_000) / 1_000);
}

async function indexKeyframes(sink: EncodedPacketSink, signal?: AbortSignal): Promise<number[]> {
	const timestamps: number[] = [];
	let packet = await sink.getFirstKeyPacket({ metadataOnly: true, verifyKeyPackets: true });
	while (packet && timestamps.length < MAX_KEYFRAMES) {
		signal?.throwIfAborted();
		timestamps.push(Math.max(0, packet.microsecondTimestamp));
		packet = await sink.getNextKeyPacket(packet, {
			metadataOnly: true,
			verifyKeyPackets: true
		});
	}
	return timestamps;
}

async function generateThumbnail(
	projectID: string,
	source: VideoSource,
	sink: VideoSampleSink,
	signal?: AbortSignal
): Promise<void> {
	signal?.throwIfAborted();
	const sample = await sink.getSample(Math.min(source.duration_us / 5, 2_000_000) / 1_000_000);
	if (!sample) return;
	try {
		const maxWidth = 640;
		const scale = Math.min(1, maxWidth / Math.max(1, sample.displayWidth));
		const canvas = new OffscreenCanvas(
			Math.max(1, Math.round(sample.displayWidth * scale)),
			Math.max(1, Math.round(sample.displayHeight * scale))
		);
		const context = canvas.getContext('2d', { alpha: false });
		if (!context) return;
		sample.draw(context, 0, 0, canvas.width, canvas.height);
		const thumbnail = await canvas.convertToBlob({ type: 'image/webp', quality: 0.78 });
		const stored = await writeProjectFile(
			projectID,
			'thumbnails',
			`${source.id}-thumbnail-v${ARTIFACT_VERSION}.webp`,
			thumbnail
		);
		await indexDisposableAsset(
			projectID,
			source.id,
			'thumbnail',
			stored.path,
			stored.size,
			`thumbnail-v${ARTIFACT_VERSION}`
		);
	} finally {
		sample.close();
	}
}

async function indexDisposableAsset(
	projectID: string,
	sourceID: string,
	kind: 'thumbnail' | 'waveform' | 'analysis',
	path: string,
	size: number,
	suffix: string
): Promise<void> {
	const now = new Date().toISOString();
	await indexProjectAsset({
		id: `${projectID}:${sourceID}:${suffix}`,
		project_id: projectID,
		source_id: sourceID,
		path,
		kind,
		size_bytes: size,
		created_at: now,
		updated_at: now,
		disposable: true
	});
}
