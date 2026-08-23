import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import VoiceNoteRecorder from './voice-note-recorder.svelte';

let recorderConstructor = vi.fn();

class FakeMediaRecorder {
	static isTypeSupported() {
		return true;
	}

	constructor() {
		recorderConstructor();
	}
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}

describe('VoiceNoteRecorder microphone permission', () => {
	const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

	afterEach(() => {
		vi.unstubAllGlobals();
		if (originalMediaDevices) {
			Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
		} else {
			Reflect.deleteProperty(navigator, 'mediaDevices');
		}
	});

	it('stops a stream that arrives after the dialog closes', async () => {
		const permission = deferred<{ getTracks: () => Array<{ stop: () => void }> }>();
		const stop = vi.fn();
		const stream = { getTracks: () => [{ stop }] };
		recorderConstructor = vi.fn();
		vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
		Object.defineProperty(navigator, 'mediaDevices', {
			configurable: true,
			value: { getUserMedia: vi.fn().mockReturnValue(permission.promise) }
		});
		const screen = await render(VoiceNoteRecorder, {
			props: { open: true, onSave: vi.fn() }
		});

		await screen.getByRole('button', { name: 'Start recording' }).click();
		await screen.getByRole('button', { name: 'Cancel' }).click();
		permission.resolve(stream);
		await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());

		expect(recorderConstructor).not.toHaveBeenCalled();
	});
});
