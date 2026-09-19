import { expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { editorSession } from '$lib/video-editor/editor.svelte';
import {
	voiceoverRecorder,
	type VoiceoverRecorderDependencies
} from '$lib/video-editor/recorder/voiceover-recorder.svelte';
import Fixture from './transport-bar.fixture.svelte';
import '../../../routes/layout.css';

it('keeps a 44px play target inside the narrow transport bar', async () => {
	await page.viewport(640, 450);
	try {
		const screen = await render(Fixture, { width: 640 });
		const transport = document.querySelector('[data-video-transport]');
		if (!(transport instanceof HTMLElement)) throw new Error('Expected transport bar');
		const play = screen.getByRole('button', { name: 'Play', exact: true }).element();
		if (!(play instanceof HTMLButtonElement)) throw new Error('Expected play button');

		expect(play.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
		expect(transport.getBoundingClientRect().height).toBeGreaterThanOrEqual(
			play.getBoundingClientRect().height + 2
		);
		const more = screen.getByRole('button', { name: 'More actions', exact: true });
		await expect.element(more).toBeVisible();
		more.element().focus();
		await userEvent.keyboard('{Enter}');
		await expect
			.element(screen.getByRole('menuitem', { name: 'Step one frame forward', exact: true }))
			.toBeVisible();
		await expect.element(screen.getByRole('menuitem', { name: 'Fit', exact: true })).toBeVisible();
		await userEvent.keyboard('{Escape}');
		await expect.element(more).toHaveFocus();
	} finally {
		await page.viewport(1280, 900);
	}
});

it('shows secondary transport controls when the Program container is wide', async () => {
	const screen = await render(Fixture, { width: 900 });

	await expect
		.element(screen.getByRole('button', { name: 'Go to start', exact: true }))
		.toBeVisible();
	await expect.element(screen.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
	expect(screen.getByRole('button', { name: 'More actions', exact: true }).query()).toBeNull();
});

it('keeps supported voiceover commands and active stop reachable at 320px', async () => {
	const recorder = {
		start: vi.fn(async () => undefined),
		pause: vi.fn(),
		resume: vi.fn(),
		stop: vi.fn(async () => ({
			blob: new Blob(['voiceover'], { type: 'audio/webm' }),
			mimeType: 'audio/webm',
			durationMs: 1_000
		})),
		cancel: vi.fn(),
		elapsedMs: vi.fn(() => 0)
	};
	voiceoverRecorder.__resetForTesting();
	voiceoverRecorder.__setDependenciesForTesting({
		createRecorder: () => recorder,
		createAudioContext: () => null,
		enumerateDevices: async () => [],
		isSupported: () => true,
		recordingExtension: () => 'webm',
		startMonitor: async () => ({ stop: vi.fn() }),
		importAudio: vi.fn<VoiceoverRecorderDependencies['importAudio']>(),
		insertOnNewTrack: vi.fn<VoiceoverRecorderDependencies['insertOnNewTrack']>()
	});
	// SAFETY: the recorder only needs the project identity and output timing for this transport test.
	editorSession.project = {
		id: 'transport-test',
		metadata: { width: 1920, height: 1080, fps: 30 }
	} as NonNullable<typeof editorSession.project>;
	await page.viewport(320, 450);

	try {
		const screen = await render(Fixture, { width: 320 });
		const more = screen.getByRole('button', { name: 'More actions', exact: true });
		const fullscreen = screen.getByRole('button', {
			name: 'Enter preview fullscreen',
			exact: true
		});
		await expect.element(more).toBeVisible();
		await expect.element(fullscreen).toBeVisible();
		for (const control of [more.element(), fullscreen.element()]) {
			const bounds = control.getBoundingClientRect();
			expect(bounds.left).toBeGreaterThanOrEqual(0);
			expect(bounds.right).toBeLessThanOrEqual(320);
		}

		await more.click();
		await expect
			.element(screen.getByRole('menuitem', { name: 'Voiceover settings', exact: true }))
			.toBeVisible();
		await screen.getByRole('menuitem', { name: 'Voiceover settings', exact: true }).click();
		await expect.element(screen.getByText('Microphone', { exact: true })).toBeVisible();
		await expect.element(screen.getByText('0 ms', { exact: true })).toBeVisible();
		const voiceoverSettings = document.querySelector('[data-voiceover-menu-settings]');
		if (!(voiceoverSettings instanceof HTMLElement)) {
			throw new Error('Expected voiceover settings submenu');
		}
		const settingsBounds = voiceoverSettings.getBoundingClientRect();
		expect(settingsBounds.left).toBeGreaterThanOrEqual(0);
		expect(settingsBounds.right).toBeLessThanOrEqual(320);
		await screen.getByRole('menuitem', { name: 'Voiceover settings', exact: true }).click();
		await screen.getByRole('menuitem', { name: 'Record voiceover', exact: true }).click();

		const stop = screen.getByRole('button', { name: 'Stop and save voiceover', exact: true });
		await expect.element(stop).toBeVisible();
		const stopBounds = stop.element().getBoundingClientRect();
		expect(stopBounds.left).toBeGreaterThanOrEqual(0);
		expect(stopBounds.right).toBeLessThanOrEqual(320);
	} finally {
		voiceoverRecorder.__resetForTesting();
		editorSession.project = null;
		await page.viewport(1280, 900);
	}
});
