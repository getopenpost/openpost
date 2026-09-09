import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import RecordingDialog from './recording-dialog.svelte';
import { ScreenCaptureRecorder } from '../recorder/recorder.svelte';
import type { RecordingImportRuntime } from '../recorder/insert-recording';
import '../../../routes/layout.css';

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
				{ kind: 'videoinput', deviceId: '', label: '', groupId: '', toJSON() {} },
				{ kind: 'audioinput', deviceId: '', label: '', groupId: '', toJSON() {} },
				{ kind: 'videoinput', deviceId: 'camera-1', label: 'USB camera', groupId: '', toJSON() {} },
				{ kind: 'audioinput', deviceId: 'mic-1', label: 'USB microphone', groupId: '', toJSON() {} }
			]);
			try {
				const screen = await render(RecordingDialog, { open: true, projectId: 'recording-test' });
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
