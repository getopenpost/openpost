import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import RecordingDialog from './recording-dialog.svelte';
import { ScreenCaptureRecorder } from '../recorder/recorder.svelte';
import type { RecordingImportRuntime } from '../recorder/insert-recording';
import '../../../routes/layout.css';
import { createRecorderPreferencesStore } from '../recorder/recorder-preferences.svelte';
import { toast } from 'svelte-sonner';

it('cancels the countdown without reporting a recording failure', async () => {
	const recorder = new ScreenCaptureRecorder();
	const preferences = createRecorderPreferencesStore(null);
	preferences.set('includeScreen', false);
	preferences.set('includeMicrophone', false);
	preferences.set('includeCamera', true);
	preferences.set('countdownSeconds', 5);
	const stream = document.createElement('canvas').captureStream(30);
	const media = vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValue(stream);
	const screen = await render(RecordingDialog, {
		open: true,
		projectId: 'countdown-test',
		recorder,
		preferences
	});
	const existingToasts = new Set(toast.getActiveToasts().map((entry) => entry.id));
	try {
		await screen.getByRole('button', { name: 'Start recording', exact: true }).click();
		await expect.poll(() => recorder.status).toBe('countdown');
		await screen.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect
			.element(screen.getByRole('button', { name: 'Start recording', exact: true }))
			.toBeEnabled();
		expect(stream.getTracks().every((track) => track.readyState === 'ended')).toBe(true);
		const feedback = toast.getActiveToasts().filter((entry) => !existingToasts.has(entry.id));
		expect(feedback.some((entry) => entry.type === 'info')).toBe(true);
		expect(feedback.filter((entry) => entry.type === 'error')).toEqual([]);
	} finally {
		media.mockRestore();
		await recorder.cancel();
	}
});

it('imports immediately stopped captures with saving feedback instead of recovery', async () => {
	const recorder = new ScreenCaptureRecorder();
	const preferences = createRecorderPreferencesStore(null);
	preferences.set('includeScreen', false);
	preferences.set('includeMicrophone', false);
	preferences.set('includeCamera', true);
	const canvas = document.createElement('canvas');
	canvas.width = 160;
	canvas.height = 90;
	const stream = canvas.captureStream(30);
	const media = vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockResolvedValue(stream);
	let releaseManifest = () => {};
	let manifestWaiting = false;
	const manifestReady = new Promise<void>((resolve) => {
		releaseManifest = resolve;
	});
	const createWritable = FileSystemFileHandle.prototype.createWritable;
	const manifestWrite = vi
		.spyOn(FileSystemFileHandle.prototype, 'createWritable')
		.mockImplementation(async function (this: FileSystemFileHandle, options) {
			if (!manifestWaiting && this.name.startsWith('capture-') && recorder.status === 'recording') {
				manifestWaiting = true;
				await manifestReady;
			}
			return createWritable.call(this, options);
		});
	let rejectImport: (error: Error) => void = () => {};
	const importVideo = vi.fn(
		() =>
			new Promise<never>((_, reject) => {
				rejectImport = reject;
			})
	);
	const screen = await render(RecordingDialog, {
		open: true,
		projectId: 'saving-test',
		recorder,
		preferences,
		importRuntime: {
			importVideo,
			importAudio: importVideo,
			rollback: async () => {}
		}
	});
	const drawing = setInterval(() => canvas.getContext('2d')!.fillRect(0, 0, 160, 90), 33);
	try {
		await screen.getByRole('button', { name: 'Start recording', exact: true }).click();
		await expect.poll(() => recorder.status).toBe('recording');
		await expect.poll(() => manifestWaiting).toBe(true);
		await screen.getByRole('button', { name: 'Stop recording', exact: true }).click();
		releaseManifest();
		await expect.poll(() => importVideo.mock.calls.length).toBe(1);
		await expect
			.element(screen.getByRole('button', { name: 'Recover recording', exact: true }))
			.not.toBeInTheDocument();
		await expect.element(screen.getByRole('status')).toHaveTextContent('Saving');
		rejectImport(new Error('Upload storage is unavailable'));
		await expect
			.element(screen.getByRole('alert'))
			.toHaveTextContent('Upload storage is unavailable');
		await expect
			.element(screen.getByRole('button', { name: 'Recover recording', exact: true }))
			.toBeEnabled();
		await expect
			.element(screen.getByRole('link', { name: 'Download Camera', exact: true }))
			.toBeVisible();
	} finally {
		releaseManifest();
		manifestWrite.mockRestore();
		rejectImport(new Error('Test finished'));
		clearInterval(drawing);
		media.mockRestore();
		await recorder.cancel();
		await recorder.discardArtifacts(recorder.lastArtifacts);
	}
});

describe('recording setup', () => {
	it('keeps the capture downloadable and displays the reason when recovery fails', async () => {
		const recorder = new ScreenCaptureRecorder();
		recorder.lastArtifacts = [
			{
				kind: 'microphone',
				blob: new Blob(['capture'], { type: 'audio/mp4' }),
				mimeType: 'audio/mp4',
				durationMs: 1000,
				startOffsetMs: 0,
				sizeBytes: 7,
				scratchId: 'test-microphone'
			}
		];
		const fail = async () => {
			throw new Error('Upload storage is unavailable');
		};
		const importRuntime: RecordingImportRuntime = {
			importAudio: fail,
			importVideo: fail,
			rollback: async () => {}
		};
		const screen = await render(RecordingDialog, {
			open: true,
			projectId: 'recording-test',
			recorder,
			importRuntime
		});
		await screen.getByRole('button', { name: 'Recover recording', exact: true }).click();
		await expect
			.element(screen.getByRole('alert'))
			.toHaveTextContent('Upload storage is unavailable');
		await expect
			.element(screen.getByRole('link', { name: 'Download Microphone', exact: true }))
			.toHaveAttribute('download', expect.stringMatching(/\.m4a$/));
		await screen.getByRole('button', { name: 'Remove recording', exact: true }).click();
		await expect.element(screen.getByRole('alert')).not.toBeInTheDocument();
	});

	it.each(['Camera', 'Microphone'])(
		'opens %s choices without exposing anonymous devices',
		async (source) => {
			const enumeration = vi.spyOn(navigator.mediaDevices, 'enumerateDevices').mockResolvedValue([
				{
					kind: 'videoinput',
					deviceId: '',
					label: '',
					groupId: '',
					toJSON() {}
				},
				{
					kind: 'audioinput',
					deviceId: '',
					label: '',
					groupId: '',
					toJSON() {}
				},
				{
					kind: 'videoinput',
					deviceId: 'camera-1',
					label: 'USB camera',
					groupId: '',
					toJSON() {}
				},
				{
					kind: 'audioinput',
					deviceId: 'mic-1',
					label: 'USB microphone',
					groupId: '',
					toJSON() {}
				}
			]);
			try {
				const screen = await render(RecordingDialog, {
					open: true,
					projectId: 'recording-test'
				});
				if (source === 'Camera')
					await screen.getByRole('checkbox', { name: 'Camera', exact: true }).click();
				await screen.getByRole('button', { name: source, exact: true }).click();
				await expect
					.element(screen.getByRole('option', { name: 'Device default', exact: true }))
					.toBeVisible();
				const name = source === 'Camera' ? 'USB camera' : 'USB microphone';
				await screen.getByRole('option', { name, exact: true }).click();
				await expect
					.element(screen.getByRole('button', { name: source, exact: true }))
					.toHaveTextContent(name);
			} finally {
				enumeration.mockRestore();
			}
		}
	);
});

it('does not report negative remaining browser storage', async () => {
	const estimate = vi
		.spyOn(navigator.storage, 'estimate')
		.mockResolvedValue({ quota: 100, usage: 200 });
	try {
		const screen = await render(RecordingDialog, {
			open: true,
			projectId: 'quota-test'
		});
		await screen.getByText('Advanced', { exact: true }).click();
		await expect
			.element(
				screen.getByText('Recording needs more local space. 0 B is currently available.', {
					exact: true
				})
			)
			.toBeVisible();
	} finally {
		estimate.mockRestore();
	}
});
