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
		: [])
];

it.each(formats)(
	'inserts real %s captures and reimports downloaded microphone audio',
	async (format) => {
		if (format === 'mp4') {
			const supported = MediaRecorder.isTypeSupported.bind(MediaRecorder);
			vi.spyOn(MediaRecorder, 'isTypeSupported').mockImplementation(
				(type) => type.endsWith('/mp4') && supported(type)
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
		const destination = audio.createMediaStreamDestination();
		oscillator.connect(destination);
		oscillator.start();
		await audio.resume();
		const streams: MediaStream[] = [];
		const videoStream = () => {
			const stream = canvas.captureStream(30);
			streams.push(stream);
			return stream;
		};
		vi.spyOn(navigator.mediaDevices, 'getDisplayMedia').mockImplementation(async () =>
			videoStream()
		);
		vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockImplementation(async (constraints) =>
			constraints?.video ? videoStream() : destination.stream
		);
		const recorder = new ScreenCaptureRecorder();
		const timer = setInterval(() => context.fillRect(0, 0, 160, 90), 33);
		try {
			await recorder.startWithSelection(
				{ screen: true, camera: true, microphone: true },
				{ countdownSeconds: 0 }
			);
			await new Promise((resolve) => setTimeout(resolve, 1500));
			const artifacts = await recorder.stop();
			expect(artifacts).toHaveLength(3);
			const result = await insertRecordingArtifacts('test-project', artifacts, 0, undefined, {
				isCurrent: () => true
			});
			expect(result.itemIds).toHaveLength(3);
			const extensions = result.mediaIds.map((id) => mediaPool.get(id)?.fileName.split('.').pop());
			expect(extensions).toEqual(
				format === 'mp4' ? ['mp4', 'mp4', 'm4a'] : ['webm', 'webm', 'webm']
			);
			expect(timelineStore.items.map((item) => item.type)).toEqual(['video', 'video', 'audio']);
			expect(timelineStore.items.every((item) => item.durationInFrames > 20)).toBe(true);
			const microphone = artifacts.find((artifact) => artifact.kind === 'microphone')!;
			// File pickers commonly label audio-only .webm downloads as video/webm.
			const downloaded = new File([microphone.blob], `microphone.${format}`, {
				type: `video/${format}`
			});
			const importedId = await importCopiedFile(downloaded, { projectId: 'test-project' });
			const imported = mediaPool.get(importedId)!;
			expect(imported).toMatchObject({ fps: 0, mimeType: `audio/${format}`, tags: ['audio'] });
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
