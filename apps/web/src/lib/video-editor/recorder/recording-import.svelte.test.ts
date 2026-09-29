import { expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { mediaPool } from '../media/pool.svelte';
import { importCopiedFile } from '../media/import.svelte';
import { insertMediaAtFrame } from '../timeline/actions/insert-media';
import { ScreenCaptureRecorder } from './recorder.svelte';
import { insertRecordingArtifacts } from './insert-recording';
import { setWorkspaceRoot } from '../workspace-fs/root';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';

const formats = [
	'webm',
	...(MediaRecorder.isTypeSupported('video/mp4') && MediaRecorder.isTypeSupported('audio/mp4')
		? ['mp4']
		: []),
	...(MediaRecorder.isTypeSupported('video/mp4;codecs=avc1,mp4a.40.2') ? ['native'] : [])
];

it.each(
	formats.flatMap((format) => [
		{ format, camera: true },
		{ format, camera: false }
	])
)(
	'inserts combined $format video audio with camera=$camera and retains standalone microphone recording',
	async ({ format, camera }) => {
		if (format !== 'native') {
			const supported = MediaRecorder.isTypeSupported.bind(MediaRecorder);
			vi.spyOn(MediaRecorder, 'isTypeSupported').mockImplementation(
				(type) => type.split(';')[0].endsWith(`/${format}`) && supported(type)
			);
		}
		await userEvent.click(document.body);
		const root = await navigator.storage.getDirectory();
		const name = `recording-test-${crypto.randomUUID()}`;
		setWorkspaceRoot(await root.getDirectoryHandle(name, { create: true }));
		timelineStore.__resetForTesting();
		const canvas = document.createElement('canvas');
		canvas.width = 160;
		canvas.height = 90;
		const context = canvas.getContext('2d')!;
		const audio = new AudioContext();
		const oscillator = audio.createOscillator();
		let destination = audio.createMediaStreamDestination();
		const systemAudio = audio.createMediaStreamDestination();
		const systemOscillator = audio.createOscillator();
		systemOscillator.frequency.value = 880;
		systemOscillator.connect(systemAudio);
		systemOscillator.start();
		oscillator.connect(destination);
		oscillator.start();
		await audio.resume();
		const streams: MediaStream[] = [];
		const videoStream = () => {
			const stream = canvas.captureStream(30);
			streams.push(stream);
			return stream;
		};
		vi.spyOn(navigator.mediaDevices, 'getDisplayMedia').mockImplementation(async () => {
			const stream = videoStream();
			stream.addTrack(systemAudio.stream.getAudioTracks()[0].clone());
			return stream;
		});
		vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockImplementation(async (constraints) =>
			constraints?.video ? videoStream() : destination.stream
		);
		const recorder = new ScreenCaptureRecorder();
		const timer = setInterval(() => context.fillRect(0, 0, 160, 90), 33);
		try {
			await recorder.startWithSelection(
				{ screen: true, camera, microphone: true },
				{ countdownSeconds: 0 }
			);
			await new Promise((resolve) => setTimeout(resolve, 1500));
			const artifacts = await recorder.stop();
			expect(artifacts).toHaveLength(camera ? 2 : 1);
			const speech = artifacts.find(
				(artifact) => artifact.kind === (camera ? 'camera' : 'screen')
			)!;
			const decoded = await audio.decodeAudioData(await speech.blob.arrayBuffer());
			const samples = decoded
				.getChannelData(0)
				.subarray(Math.round(decoded.sampleRate * 0.3), Math.round(decoded.sampleRate * 0.8));
			const amplitudeAt = (frequency: number) => {
				let sine = 0;
				let cosine = 0;
				for (let i = 0; i < samples.length; i++) {
					const phase = (2 * Math.PI * frequency * i) / decoded.sampleRate;
					sine += samples[i]! * Math.sin(phase);
					cosine += samples[i]! * Math.cos(phase);
				}
				return (2 * Math.hypot(sine, cosine)) / samples.length;
			};
			// Distinct input tones prove the saved file contains the microphone and,
			// for screen-only capture, system sound as well.
			expect(amplitudeAt(440)).toBeGreaterThan(0.1);
			if (!camera) expect(amplitudeAt(880)).toBeGreaterThan(0.1);
			const result = await insertRecordingArtifacts('test-project', artifacts, 0, undefined, {
				isCurrent: () => true
			});
			expect(result.itemIds).toHaveLength(camera ? 2 : 1);
			const audioCodec = mediaPool.get(result.mediaIds[0])?.audioCodec;
			if (format === 'mp4') {
				// Generic MP4 lets the browser choose its audio codec.
				expect(['aac', 'opus']).toContain(audioCodec);
			} else {
				expect(audioCodec).toBe(format === 'native' ? 'aac' : 'opus');
			}
			const extensions = result.mediaIds.map((id) => mediaPool.get(id)?.fileName.split('.').pop());
			expect(extensions).toEqual(
				camera
					? [format === 'webm' ? 'webm' : 'mp4', format === 'webm' ? 'webm' : 'mp4']
					: [format === 'webm' ? 'webm' : 'mp4']
			);
			expect(timelineStore.items.map((item) => item.type)).toEqual(
				camera ? ['video', 'video'] : ['video']
			);
			expect(timelineStore.items.every((item) => item.durationInFrames > 20)).toBe(true);
			await recorder.discardArtifacts(artifacts);
			destination = audio.createMediaStreamDestination();
			oscillator.connect(destination);
			await recorder.startWithSelection({ screen: false, camera: false, microphone: true });
			await new Promise((resolve) => setTimeout(resolve, 500));
			const [microphone] = await recorder.stop();
			expect(microphone.kind).toBe('microphone');
			// File pickers commonly label audio-only .webm downloads as video/webm.
			const audioFormat = format === 'native' ? 'webm' : format;
			const downloaded = new File([microphone.blob], `microphone.${audioFormat}`, {
				type: `video/${audioFormat}`
			});
			const importedId = await importCopiedFile(downloaded, {
				projectId: 'test-project'
			});
			const imported = mediaPool.get(importedId)!;
			expect(imported).toMatchObject({
				fps: 0,
				mimeType: `audio/${audioFormat}`,
				tags: ['audio']
			});
			const itemId = insertMediaAtFrame(imported, 90);
			expect(timelineStore.items.find((item) => item.id === itemId)).toMatchObject({
				type: 'audio',
				from: 90
			});
		} finally {
			clearInterval(timer);
			await recorder.cancel();
			await recorder.discardArtifacts(recorder.lastArtifacts);
			streams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
			await audio.close();
			vi.restoreAllMocks();
			mediaPool.clear();
			setWorkspaceRoot(null);
			await root.removeEntry(name, { recursive: true });
		}
	},
	20000
);

it('reports an unstarted screen share separately from denied camera access', async () => {
	const recorder = new ScreenCaptureRecorder();
	vi.spyOn(navigator.mediaDevices, 'getDisplayMedia').mockRejectedValue(
		new DOMException('Permission denied', 'NotAllowedError')
	);
	try {
		await expect(
			recorder.startWithSelection({
				screen: true,
				camera: false,
				microphone: false
			})
		).rejects.toThrow();
		expect(recorder.error).toBe('screen-share-not-started');
		expect(recorder.status).toBe('error');
		vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockRejectedValue(
			new DOMException('Permission denied', 'NotAllowedError')
		);
		await expect(
			recorder.startWithSelection({
				screen: false,
				camera: true,
				microphone: false
			})
		).rejects.toThrow();
		expect(recorder.error).toBe('permission-denied');
	} finally {
		await recorder.cancel();
		vi.restoreAllMocks();
	}
});

it.each(['finish', 'cancel'])(
	'releases capture devices while saving, then can %s',
	async (action) => {
		const canvas = document.createElement('canvas');
		canvas.width = 160;
		canvas.height = 90;
		const stream = canvas.captureStream(30);
		const media = vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValue(stream);
		const recorder = new ScreenCaptureRecorder();
		let releaseRead = () => {};
		const waiting = new Promise<void>((resolve) => {
			releaseRead = resolve;
		});
		let reading = false;
		const getFile = FileSystemFileHandle.prototype.getFile;
		const read = vi
			.spyOn(FileSystemFileHandle.prototype, 'getFile')
			.mockImplementation(async function (this: FileSystemFileHandle) {
				if (this.name.startsWith('camera-')) {
					reading = true;
					await waiting;
				}
				return getFile.call(this);
			});
		const draw = setInterval(() => canvas.getContext('2d')!.fillRect(0, 0, 160, 90), 33);
		try {
			await recorder.startWithSelection({
				screen: false,
				camera: true,
				microphone: false
			});
			const stoppedAt = performance.now();
			const clock = vi.spyOn(performance, 'now').mockReturnValue(stoppedAt);
			const stopped = recorder.stop();
			await expect.poll(() => reading).toBe(true);
			clock.mockReturnValue(stoppedAt + 10_000);
			try {
				expect(stream.getVideoTracks()[0].readyState).toBe('ended');
				if (action === 'cancel') await recorder.cancel();
			} finally {
				releaseRead();
			}
			const artifacts = await stopped;
			if (action === 'finish') expect(artifacts[0].durationMs).toBeLessThan(1000);
			else {
				expect(artifacts).toEqual([]);
				expect(recorder.lastArtifacts).toEqual([]);
				expect(recorder.error).toBeNull();
				expect(recorder.status).toBe('idle');
			}
			clock.mockRestore();
		} finally {
			releaseRead();
			clearInterval(draw);
			read.mockRestore();
			media.mockRestore();
			vi.restoreAllMocks();
			await recorder.cancel();
			await recorder.discardArtifacts(recorder.lastArtifacts);
		}
	}
);
