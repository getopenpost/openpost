import {
	ALL_FORMATS,
	AudioBufferSink,
	BlobSource,
	Conversion,
	EncodedPacketSink,
	Input,
	Output,
	VideoSampleSink,
	WebMOutputFormat
} from 'mediabunny';
import type { VideoSource } from '@openpost/video-project';
import { createStreamingOutputTarget } from '$lib/video/stream-target';
import {
	indexProjectAsset,
	listProjectAssets,
	readProjectFile,
	writeProjectFile,
	writeProjectStream
} from './storage';
import { hashLocalFile } from './file-hash';
import { proxyReason, type ProxyReason } from './proxy-policy';

const ARTIFACT_VERSION = 4;
const WAVEFORM_BUCKETS = 720;
const MAX_KEYFRAMES = 16_000;

export interface SourceArtifactIndex {
	version: number;
	complete: boolean;
	source_id: string;
	duration_us: number;
	frame_rate: number;
	proxy_reason: ProxyReason;
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
	const contentHash =
		source.content_hash ||
		(await hashLocalFile(
			new File([file], source.original_name, { type: source.mime_type }),
			signal
		));
	const artifactKey = `${contentHash}:source-artifacts:v${ARTIFACT_VERSION}`;
	const existing = (await listProjectAssets(projectID, source.id)).find(
		(asset) => asset.content_hash === artifactKey && asset.kind === 'analysis'
	);
	if (existing) {
		const stored = await readProjectFile(existing.path);
		if (stored) {
			try {
				const parsed = JSON.parse(await stored.text()) as SourceArtifactIndex;
				if (parsed.complete) return parsed;
			} catch {
				// Regenerate an invalid disposable artifact.
			}
		}
	}
	signal?.throwIfAborted();
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
	try {
		const [videoTrack, audioTrack] = await Promise.all([
			input.getPrimaryVideoTrack(),
			input.getPrimaryAudioTrack()
		]);
		const [keyframesUS, packetStats] = await Promise.all([
			videoTrack
				? indexKeyframes(new EncodedPacketSink(videoTrack), signal)
				: Promise.resolve<number[]>([]),
			videoTrack
				? videoTrack.computePacketStats(180)
				: Promise.resolve({ packetCount: 0, averagePacketRate: 0, averageBitrate: 0 })
		]);
		const estimatedFrameRate = packetStats.averagePacketRate || 0;
		const reason = proxyReason(source, estimatedFrameRate);
		let artifact: SourceArtifactIndex = {
			version: ARTIFACT_VERSION,
			complete: false,
			source_id: source.id,
			duration_us: source.duration_us,
			frame_rate: estimatedFrameRate,
			proxy_reason: reason,
			keyframes_us: keyframesUS,
			waveform_peaks: []
		};
		await saveArtifactIndex(projectID, source.id, contentHash, artifactKey, artifact);
		if (videoTrack && (await videoTrack.canDecode())) {
			await generateThumbnail(
				projectID,
				source,
				new VideoSampleSink(videoTrack),
				artifactKey,
				signal
			);
		}
		if (reason) {
			await generateProxy(projectID, source, file, contentHash, signal);
		}
		const waveformPeaks =
			audioTrack && (await audioTrack.canDecode())
				? await generateWaveformPeaks(
						new AudioBufferSink(audioTrack),
						source.duration_us,
						WAVEFORM_BUCKETS,
						signal
					)
				: [];
		artifact = { ...artifact, complete: true, waveform_peaks: waveformPeaks };
		await saveArtifactIndex(projectID, source.id, contentHash, artifactKey, artifact);
		if (waveformPeaks.length) {
			const waveform = new TextEncoder().encode(JSON.stringify(waveformPeaks));
			const savedWaveform = await writeProjectFile(
				projectID,
				'waveforms',
				`${contentHash}-waveform-v${ARTIFACT_VERSION}.json`,
				waveform
			);
			await indexDisposableAsset(
				projectID,
				source.id,
				'waveform',
				savedWaveform.path,
				savedWaveform.size,
				`${contentHash}:waveform:v${ARTIFACT_VERSION}`
			);
		}
		return artifact;
	} finally {
		if (!input.disposed) input.dispose();
	}
}

async function saveArtifactIndex(
	projectID: string,
	sourceID: string,
	contentHash: string,
	artifactKey: string,
	artifact: SourceArtifactIndex
): Promise<void> {
	const encoded = new TextEncoder().encode(JSON.stringify(artifact));
	const stored = await writeProjectFile(
		projectID,
		'analysis',
		`${contentHash}-source-index-v${ARTIFACT_VERSION}.json`,
		encoded
	);
	await indexDisposableAsset(
		projectID,
		sourceID,
		'analysis',
		stored.path,
		stored.size,
		artifactKey
	);
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
	// Verification needs packet data; Mediabunny rejects combining it with metadataOnly.
	let packet = await sink.getFirstKeyPacket({ verifyKeyPackets: true });
	while (packet && timestamps.length < MAX_KEYFRAMES) {
		signal?.throwIfAborted();
		timestamps.push(Math.max(0, packet.microsecondTimestamp));
		packet = await sink.getNextKeyPacket(packet, {
			verifyKeyPackets: true
		});
	}
	return timestamps;
}

async function generateThumbnail(
	projectID: string,
	source: VideoSource,
	sink: VideoSampleSink,
	artifactKey: string,
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
			`${artifactKey.split(':')[0]}-thumbnail-v${ARTIFACT_VERSION}.webp`,
			thumbnail
		);
		await indexDisposableAsset(
			projectID,
			source.id,
			'thumbnail',
			stored.path,
			stored.size,
			`${artifactKey}:thumbnail`
		);
	} finally {
		sample.close();
	}
}

async function indexDisposableAsset(
	projectID: string,
	sourceID: string,
	kind: 'thumbnail' | 'waveform' | 'analysis' | 'proxy',
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
		content_hash: suffix,
		created_at: now,
		updated_at: now,
		disposable: true
	});
}

async function generateProxy(
	projectID: string,
	source: VideoSource,
	file: File,
	contentHash: string,
	signal?: AbortSignal
): Promise<void> {
	const longSource = source.duration_us >= 30 * 60 * 1_000_000;
	const maxEdge = longSource ? 960 : 1280;
	const frameRate = longSource ? 24 : 30;
	const videoBitrate = longSource ? 1_500_000 : 3_500_000;
	const audioBitrate = longSource ? 96_000 : 128_000;
	const profile = longSource ? 'webm-540p24' : 'webm-720p30';
	const artifactHash = `${contentHash}:proxy:${profile}:v${ARTIFACT_VERSION}`;
	const existing = (await listProjectAssets(projectID, source.id)).find(
		(asset) => asset.kind === 'proxy' && asset.content_hash === artifactHash
	);
	if (existing && (await readProjectFile(existing.path))) return;
	const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
	const width = Math.max(2, Math.round((source.width * scale) / 2) * 2);
	const height = Math.max(2, Math.round((source.height * scale) / 2) * 2);
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
	const sink = await createStreamingOutputTarget(signal);
	const output = new Output({
		format: new WebMOutputFormat(),
		target: sink.target
	});
	let conversion: Conversion | undefined;
	const abort = () => void conversion?.cancel();
	signal?.addEventListener('abort', abort, { once: true });
	try {
		conversion = await Conversion.init({
			input,
			output,
			tracks: 'primary',
			video: {
				width,
				height,
				fit: 'contain',
				frameRate,
				codec: 'vp9',
				bitrate: videoBitrate,
				keyFrameInterval: 2,
				hardwareAcceleration: 'prefer-hardware',
				forceTranscode: true
			},
			audio: {
				codec: 'opus',
				bitrate: audioBitrate,
				sampleRate: 48_000,
				numberOfChannels: 2,
				forceTranscode: true
			},
			showWarnings: false
		});
		if (!conversion.isValid) {
			await sink.discard();
			return;
		}
		await conversion.execute();
		const proxy = await sink.file(`${contentHash}-proxy.webm`, 'video/webm');
		const stored = await writeProjectStream(
			projectID,
			'proxies',
			`${contentHash}-proxy-v${ARTIFACT_VERSION}.webm`,
			proxy.stream(),
			{ expectedSize: proxy.size, signal }
		);
		await indexDisposableAsset(
			projectID,
			source.id,
			'proxy',
			stored.path,
			stored.size,
			artifactHash
		);
		await sink.discard();
	} catch (cause) {
		await sink.discard();
		if (signal?.aborted) throw signal.reason;
		throw cause;
	} finally {
		signal?.removeEventListener('abort', abort);
		if (!input.disposed) input.dispose();
	}
}
