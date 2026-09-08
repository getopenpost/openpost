import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import RecordingDialog from './recording-dialog.svelte';

describe('recording setup', () => {
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
