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
import { createFileSystemAccessOutputTarget } from '$lib/video/stream-target';
import {
	recoverVideoStorageBudget,
	indexProjectAsset,
	listProjectAssets,
	projectFileHandle,
	readProjectFile,
	removeDisposableProjectAssets,
	removeProjectFile,
	writeProjectFile
} from './storage';
import { proxyReason, type ProxyReason } from './proxy-policy';

const ARTIFACT_VERSION = 6;
const WAVEFORM_BUCKETS = 720;
const ARTIFACT_EVENT = 'openpost:video-source-artifact';

export type SourceArtifactProfile = 'index' | 'editor';
export type SourceArtifactPhase =
	'indexing' | 'thumbnail' | 'waveform' | 'proxy' | 'ready' | 'failed';
export type ProxyGenerationState =
	'not-needed' | 'pending' | 'running' | 'ready' | 'blocked-storage' | 'cancelled' | 'failed';

export interface SourceArtifactIndex {
	version: number;
	complete: boolean;
	index_complete: boolean;
	editor_complete: boolean;
	source_id: string;
	duration_us: number;
	frame_rate: number;
	phase: SourceArtifactPhase;
	progress: number;
	proxy_reason: ProxyReason;
	proxy_state: ProxyGenerationState;
	proxy_progress: number;
	keyframes_us: number[];
	waveform_peaks: number[];
	thumbnail_complete: boolean;
	waveform_complete: boolean;
	error?: string;
}

export interface SourceArtifactProgress {
	project_id: string;
	source_id: string;
	artifact: SourceArtifactIndex;
}

export interface SourceArtifactOptions {
	profile?: SourceArtifactProfile;
	signal?: AbortSignal;
	onProgress?: (progress: SourceArtifactProgress) => void;
}

const runningJobs = new Map<string, Promise<SourceArtifactIndex | null>>();
const runningControllers = new Map<string, AbortController>();
let heavyTaskTail: Promise<void> = Promise.resolve();

export function subscribeToSourceArtifacts(
	listener: (progress: SourceArtifactProgress) => void
): () => void {
	if (typeof window === 'undefined') return () => undefined;
	const handler = (event: Event) => listener((event as CustomEvent<SourceArtifactProgress>).detail);
	window.addEventListener(ARTIFACT_EVENT, handler);
	return () => window.removeEventListener(ARTIFACT_EVENT, handler);
}

export function cancelSourceArtifactGeneration(projectID: string, sourceID: string): void {
	for (const [key, controller] of runningControllers) {
		if (key.startsWith(`${projectID}:${sourceID}:`)) {
			controller.abort(new DOMException('Cancelled', 'AbortError'));
		}
	}
}

export async function removeSourcePreviewProxy(
	projectID: string,
	source: VideoSource
): Promise<number> {
	cancelSourceArtifactGeneration(projectID, source.id);
	const removed = await removeDisposableProjectAssets(projectID, {
		sourceID: source.id,
		kinds: ['proxy']
	});
	const file =
		source.locator.type === 'local-opfs' ? await readProjectFile(source.locator.path) : null;
	const artifact = await getSourceArtifactIndex(projectID, source.id);
	if (file && artifact) {
		const identity = artifactIdentity(source, file);
		const next: SourceArtifactIndex = {
			...artifact,
			complete: false,
			editor_complete: false,
			phase: artifact.proxy_reason ? 'proxy' : 'ready',
			progress: artifact.proxy_reason ? 0.75 : 1,
			proxy_state: artifact.proxy_reason ? 'pending' : 'not-needed',
			proxy_progress: 0,
			error: undefined
		};
		await saveArtifactIndex(
			projectID,
			source.id,
			identity,
			`${identity}:source-artifacts:v${ARTIFACT_VERSION}`,
			next
		);
		notifyArtifact(projectID, next);
	}
	return removed.removed_bytes;
}

export async function resetSourceArtifacts(
	projectID: string,
	source: VideoSource
): Promise<number> {
	cancelSourceArtifactGeneration(projectID, source.id);
	const removed = await removeDisposableProjectAssets(projectID, {
		sourceID: source.id,
		kinds: ['analysis', 'thumbnail', 'waveform', 'proxy']
	});
	const next = emptyArtifact(source);
	notifyArtifact(projectID, next);
	return removed.removed_bytes;
}

export async function getSourceArtifactIndex(
	projectID: string,
	sourceID: string
): Promise<SourceArtifactIndex | null> {
	const assets = (await listProjectAssets(projectID, sourceID)).filter(
		(asset) => asset.kind === 'analysis'
	);
	for (const asset of assets) {
		const stored = await readProjectFile(asset.path);
		if (!stored) continue;
		try {
			const parsed = JSON.parse(await stored.text()) as SourceArtifactIndex;
			if (parsed.version === ARTIFACT_VERSION && parsed.source_id === sourceID) return parsed;
		} catch {
			// Invalid analysis assets are disposable and will be replaced.
		}
	}
	return null;
}

export async function ensureSourceArtifacts(
	projectID: string,
	source: VideoSource,
	options: SourceArtifactOptions = {}
): Promise<SourceArtifactIndex | null> {
	if (source.locator.type !== 'local-opfs' || source.kind === 'image') return null;
	const profile = options.profile ?? 'editor';
	const key = `${projectID}:${source.id}:${profile}`;
	const existingJob = runningJobs.get(key);
	if (existingJob) return await existingJob;
	if (profile === 'editor') {
		const indexingJob = runningJobs.get(`${projectID}:${source.id}:index`);
		if (indexingJob) {
			await indexingJob;
			options.signal?.throwIfAborted();
			return await ensureSourceArtifacts(projectID, source, options);
		}
	}
	const controller = new AbortController();
	const abort = () => controller.abort(options.signal?.reason);
	options.signal?.addEventListener('abort', abort, { once: true });
	runningControllers.set(key, controller);
	const promise = buildSourceArtifacts(projectID, source, profile, {
		signal: controller.signal,
		onProgress: options.onProgress
	}).finally(() => {
		options.signal?.removeEventListener('abort', abort);
		runningJobs.delete(key);
		runningControllers.delete(key);
	});
	runningJobs.set(key, promise);
	return await promise;
}

async function buildSourceArtifacts(
	projectID: string,
	source: VideoSource,
	profile: SourceArtifactProfile,
	options: Required<Pick<SourceArtifactOptions, 'signal'>> &
		Pick<SourceArtifactOptions, 'onProgress'>
): Promise<SourceArtifactIndex | null> {
	const file = await readProjectFile(
		source.locator.type === 'local-opfs' ? source.locator.path : ''
	);
	if (!file) return null;
	const identity = artifactIdentity(source, file);
	const artifactKey = `${identity}:source-artifacts:v${ARTIFACT_VERSION}`;
	let artifact = await getSourceArtifactIndex(projectID, source.id);
	if (artifact?.index_complete && (profile === 'index' || artifact.editor_complete)) {
		notifyArtifact(projectID, artifact, options.onProgress);
		return artifact;
	}

	options.signal.throwIfAborted();
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
	try {
		const [videoTrack, audioTrack] = await Promise.all([
			input.getPrimaryVideoTrack(),
			input.getPrimaryAudioTrack()
		]);
		if (!artifact?.index_complete) {
			artifact = emptyArtifact(source);
			notifyArtifact(projectID, artifact, options.onProgress);
			const packetStats = videoTrack
				? await videoTrack.computePacketStats(180)
				: { packetCount: 0, averagePacketRate: 0, averageBitrate: 0 };
			const keyframesUS = videoTrack
				? await indexKeyframes(
						new EncodedPacketSink(videoTrack),
						source.duration_us,
						options.signal,
						(fraction) => {
							artifact = { ...artifact!, progress: fraction * 0.45 };
							notifyArtifact(projectID, artifact, options.onProgress);
						}
					)
				: [];
			const estimatedFrameRate = packetStats.averagePacketRate || 0;
			const reason = proxyReason(source, estimatedFrameRate);
			artifact = {
				...artifact,
				complete: profile === 'index',
				index_complete: true,
				phase: profile === 'index' ? 'ready' : 'thumbnail',
				progress: profile === 'index' ? 1 : 0.45,
				frame_rate: estimatedFrameRate,
				proxy_reason: reason,
				proxy_state: reason ? 'pending' : 'not-needed',
				keyframes_us: keyframesUS
			};
			await saveArtifactIndex(projectID, source.id, identity, artifactKey, artifact);
			notifyArtifact(projectID, artifact, options.onProgress);
		}

		if (profile === 'index') return artifact;
		return await runHeavyTask(async () => {
			try {
				options.signal.throwIfAborted();
				if (!artifact!.thumbnail_complete && videoTrack && (await videoTrack.canDecode())) {
					artifact = { ...artifact!, phase: 'thumbnail', progress: 0.5 };
					notifyArtifact(projectID, artifact, options.onProgress);
					await generateThumbnail(
						projectID,
						source,
						new VideoSampleSink(videoTrack),
						artifactKey,
						options.signal
					);
				}
				artifact = { ...artifact!, thumbnail_complete: true, phase: 'waveform', progress: 0.55 };
				notifyArtifact(projectID, artifact, options.onProgress);

				let waveformPeaks = artifact!.waveform_peaks;
				if (!artifact!.waveform_complete && audioTrack && (await audioTrack.canDecode())) {
					waveformPeaks = await generateWaveformPeaks(
						new AudioBufferSink(audioTrack),
						source.duration_us,
						WAVEFORM_BUCKETS,
						options.signal,
						(fraction) => {
							artifact = { ...artifact!, progress: 0.55 + fraction * 0.2 };
							notifyArtifact(projectID, artifact, options.onProgress);
						}
					);
					await saveWaveform(projectID, source.id, identity, waveformPeaks);
				}
				artifact = {
					...artifact!,
					waveform_peaks: waveformPeaks,
					waveform_complete: true,
					phase: artifact!.proxy_reason ? 'proxy' : 'ready',
					progress: artifact!.proxy_reason ? 0.75 : 1
				};
				await saveArtifactIndex(projectID, source.id, identity, artifactKey, artifact);
				notifyArtifact(projectID, artifact, options.onProgress);

				if (artifact.proxy_reason && artifact.proxy_state !== 'ready') {
					artifact = { ...artifact, proxy_state: 'running', proxy_progress: 0 };
					notifyArtifact(projectID, artifact, options.onProgress);
					try {
						await generateProxyOffMainThread(
							projectID,
							source,
							file,
							identity,
							options.signal,
							(fraction) => {
								artifact = {
									...artifact!,
									proxy_progress: fraction,
									progress: 0.75 + fraction * 0.25
								};
								notifyArtifact(projectID, artifact, options.onProgress);
							}
						);
						artifact = { ...artifact, proxy_state: 'ready', proxy_progress: 1 };
					} catch (cause) {
						if (options.signal.aborted) {
							artifact = { ...artifact, proxy_state: 'cancelled' };
							throw options.signal.reason;
						}
						const message = cause instanceof Error ? cause.message : 'Proxy generation failed.';
						artifact = {
							...artifact,
							proxy_state: message.startsWith('Not enough local space')
								? 'blocked-storage'
								: 'failed',
							error: message
						};
					}
				}
				const editorComplete =
					!artifact.proxy_reason ||
					artifact.proxy_state === 'ready' ||
					artifact.proxy_state === 'not-needed';
				artifact = {
					...artifact,
					complete: editorComplete,
					editor_complete: editorComplete,
					phase: editorComplete ? 'ready' : 'failed',
					progress: editorComplete ? 1 : artifact.progress
				};
				await saveArtifactIndex(projectID, source.id, identity, artifactKey, artifact);
				notifyArtifact(projectID, artifact, options.onProgress);
				return artifact;
			} catch (cause) {
				if (artifact) {
					artifact = {
						...artifact,
						phase: 'failed',
						proxy_state: options.signal.aborted ? 'cancelled' : artifact.proxy_state,
						error: cause instanceof Error ? cause.message : 'Artifact generation failed.'
					};
					await saveArtifactIndex(projectID, source.id, identity, artifactKey, artifact).catch(
						() => undefined
					);
					notifyArtifact(projectID, artifact, options.onProgress);
				}
				throw cause;
			}
		});
	} finally {
		if (!input.disposed) input.dispose();
	}
}

function emptyArtifact(source: VideoSource): SourceArtifactIndex {
	return {
		version: ARTIFACT_VERSION,
		complete: false,
		index_complete: false,
		editor_complete: false,
		source_id: source.id,
		duration_us: source.duration_us,
		frame_rate: 0,
		phase: 'indexing',
		progress: 0,
		proxy_reason: null,
		proxy_state: 'not-needed',
		proxy_progress: 0,
		keyframes_us: [],
		waveform_peaks: [],
		thumbnail_complete: false,
		waveform_complete: false
	};
}

function artifactIdentity(source: VideoSource, file: File): string {
	return (
		source.content_hash ??
		`${source.id}-${source.size_bytes}-${file.lastModified || source.duration_us}`
	).replace(/[^a-zA-Z0-9._-]+/gu, '-');
}

function notifyArtifact(
	projectID: string,
	artifact: SourceArtifactIndex,
	callback?: SourceArtifactOptions['onProgress']
): void {
	const progress = {
		project_id: projectID,
		source_id: artifact.source_id,
		artifact: structuredClone(artifact)
	};
	callback?.(progress);
	if (typeof window !== 'undefined') {
		window.dispatchEvent(
			new CustomEvent<SourceArtifactProgress>(ARTIFACT_EVENT, { detail: progress })
		);
	}
}

async function runHeavyTask<T>(work: () => Promise<T>): Promise<T> {
	const previous = heavyTaskTail;
	let release!: () => void;
	heavyTaskTail = new Promise<void>((resolve) => (release = resolve));
	await previous.catch(() => undefined);
	try {
		return await work();
	} finally {
		release();
	}
}

async function saveArtifactIndex(
	projectID: string,
	sourceID: string,
	identity: string,
	artifactKey: string,
	artifact: SourceArtifactIndex
): Promise<void> {
	const encoded = new TextEncoder().encode(JSON.stringify(artifact));
	const stored = await writeProjectFile(
		projectID,
		'analysis',
		`${identity}-source-index-v${ARTIFACT_VERSION}.json`,
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

async function saveWaveform(
	projectID: string,
	sourceID: string,
	identity: string,
	waveformPeaks: number[]
): Promise<void> {
	if (!waveformPeaks.length) return;
	const waveform = new TextEncoder().encode(JSON.stringify(waveformPeaks));
	const saved = await writeProjectFile(
		projectID,
		'waveforms',
		`${identity}-waveform-v${ARTIFACT_VERSION}.json`,
		waveform
	);
	await indexDisposableAsset(
		projectID,
		sourceID,
		'waveform',
		saved.path,
		saved.size,
		`${identity}:waveform:v${ARTIFACT_VERSION}`
	);
}

export async function generateWaveformPeaks(
	sink: AudioBufferSink,
	durationUS: number,
	bucketCount = WAVEFORM_BUCKETS,
	signal?: AbortSignal,
	onProgress?: (fraction: number) => void
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
		onProgress?.(Math.min(1, (wrapped.timestamp + wrapped.duration) / durationSeconds));
	}
	return Array.from(peaks, (peak) => Math.round(Math.min(1, peak) * 1_000) / 1_000);
}

async function indexKeyframes(
	sink: EncodedPacketSink,
	durationUS: number,
	signal?: AbortSignal,
	onProgress?: (fraction: number) => void
): Promise<number[]> {
	const timestamps: number[] = [];
	let packet = await sink.getFirstKeyPacket({ verifyKeyPackets: true });
	while (packet) {
		signal?.throwIfAborted();
		const timestampUS = Math.max(0, packet.microsecondTimestamp);
		timestamps.push(timestampUS);
		if (timestamps.length % 16 === 0) {
			onProgress?.(Math.min(0.99, timestampUS / Math.max(1, durationUS)));
		}
		packet = await sink.getNextKeyPacket(packet, { verifyKeyPackets: true });
	}
	onProgress?.(1);
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

export async function generateProxy(
	projectID: string,
	source: VideoSource,
	file: File,
	identity: string,
	signal?: AbortSignal,
	onProgress?: (fraction: number) => void
): Promise<void> {
	const longSource = source.duration_us >= 30 * 60 * 1_000_000;
	const maxEdge = longSource ? 960 : 1280;
	const frameRate = longSource ? 24 : 30;
	const videoBitrate = longSource ? 1_500_000 : 3_500_000;
	const audioBitrate = longSource ? 96_000 : 128_000;
	const profile = longSource ? 'webm-540p24' : 'webm-720p30';
	const artifactHash = `${identity}:proxy:${profile}:v${ARTIFACT_VERSION}`;
	const existing = (await listProjectAssets(projectID, source.id)).find(
		(asset) => asset.kind === 'proxy' && asset.content_hash === artifactHash
	);
	if (existing && (await readProjectFile(existing.path))) {
		onProgress?.(1);
		return;
	}
	const estimatedBytes = Math.ceil(
		(source.duration_us / 1_000_000) * ((videoBitrate + audioBitrate) / 8) * 1.08
	);
	const budget = await recoverVideoStorageBudget(estimatedBytes, {
		protectedProjectIDs: [projectID],
		signal
	});
	if (!budget.can_continue) {
		throw new Error(
			`Not enough local space for the preview proxy. It needs about ${Math.ceil((estimatedBytes + budget.headroom_bytes) / 1_048_576)} MB.`
		);
	}
	const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
	const width = Math.max(2, Math.round((source.width * scale) / 2) * 2);
	const height = Math.max(2, Math.round((source.height * scale) / 2) * 2);
	const fileName = `${identity}-proxy-v${ARTIFACT_VERSION}.webm`;
	const destination = await projectFileHandle(projectID, 'proxies', fileName);
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
	const sink = await createFileSystemAccessOutputTarget(destination.handle, signal);
	const output = new Output({ format: new WebMOutputFormat(), target: sink.target });
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
		if (!conversion.isValid) throw new Error('This browser cannot encode the preview proxy.');
		conversion.onProgress = (fraction) => onProgress?.(fraction);
		await conversion.execute();
		const proxy = await sink.file(fileName, 'video/webm');
		await indexDisposableAsset(
			projectID,
			source.id,
			'proxy',
			destination.path,
			proxy.size,
			artifactHash
		);
		onProgress?.(1);
	} catch (cause) {
		await sink.discard();
		await removeProjectFile(destination.path).catch(() => undefined);
		if (signal?.aborted) throw signal.reason;
		throw cause;
	} finally {
		signal?.removeEventListener('abort', abort);
		if (!input.disposed) input.dispose();
	}
}

async function generateProxyOffMainThread(
	projectID: string,
	source: VideoSource,
	file: File,
	identity: string,
	signal?: AbortSignal,
	onProgress?: (fraction: number) => void
): Promise<void> {
	if (typeof Worker === 'undefined') {
		await generateProxy(projectID, source, file, identity, signal, onProgress);
		return;
	}
	const worker = new Worker(new URL('./proxy-generation.worker.ts', import.meta.url), {
		type: 'module',
		name: 'openpost-preview-proxy'
	});
	try {
		await new Promise<void>((resolve, reject) => {
			let settled = false;
			let cancellationFallback: ReturnType<typeof setTimeout> | undefined;
			const finish = (callback: () => void) => {
				if (settled) return;
				settled = true;
				if (cancellationFallback) clearTimeout(cancellationFallback);
				signal?.removeEventListener('abort', abort);
				callback();
			};
			const abort = () => {
				worker.postMessage({ type: 'cancel' });
				cancellationFallback = setTimeout(
					() => finish(() => reject(signal?.reason ?? new DOMException('Cancelled', 'AbortError'))),
					3_000
				);
			};
			worker.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
				if (event.data.type === 'progress') {
					onProgress?.(Number(event.data.fraction ?? 0));
					return;
				}
				if (event.data.type === 'complete') {
					finish(resolve);
					return;
				}
				if (event.data.type === 'error') {
					if (signal?.aborted) {
						finish(() => reject(signal.reason ?? new DOMException('Cancelled', 'AbortError')));
						return;
					}
					const error = new Error(String(event.data.message ?? 'Proxy generation failed.'));
					error.name = String(event.data.name ?? 'Error');
					finish(() => reject(error));
				}
			};
			worker.onerror = (event) =>
				finish(() => reject(event.error ?? new Error(event.message || 'Proxy worker failed.')));
			signal?.addEventListener('abort', abort, { once: true });
			if (signal?.aborted) {
				abort();
				return;
			}
			worker.postMessage({ type: 'generate', projectID, source, file, identity });
		});
	} finally {
		worker.terminate();
	}
}
