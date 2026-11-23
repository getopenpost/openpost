import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import '../../../routes/layout.css';
import { m } from '$lib/paraglide/messages';
import { createBlankProject } from '../project/defaults';
import type { TimelineItem, TimelineTrack } from '../project/types';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { createProject, getProject } from '../workspace-fs/projects';
import { getWorkspaceRoot, setWorkspaceRoot } from '@openpost/editor-shared/workspace';
import AudioDuckingPanel from './audio-ducking-panel.svelte';
import AudioEqPanel from './audio-eq-panel.svelte';
import AudioMixerPanel from './audio-mixer-panel.svelte';
import LocalMusicPanel from './local-music-panel.svelte';

afterEach(() => {
	sequenceStore.reset();
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
});

describe('AudioDuckingPanel', () => {
	it('turns ducking off at zero, preserves its undo settings and keeps it off after reopening', async () => {
		const project = createBlankProject('Zero ducking');
		project.timeline!.items = [
			{
				id: 'voice',
				label: 'Voice',
				type: 'audio',
				trackId: 'track-audio-main',
				from: 0,
				durationInFrames: 240,
				audioDucking: {
					duckOthersDb: -12,
					attackSec: 0.2,
					releaseSec: 0.4,
					targetTrackIds: ['music']
				}
			}
		];
		sequenceStore.load(project.timeline!, project.metadata);
		commandHistory.clearHistory();
		const screen = await render(AudioDuckingPanel, { item: timelineStore.itemById.get('voice')! });
		const toggle = screen.getByRole('button', { name: m.video_editor_duck_enable() });
		await expect.element(toggle).toHaveAttribute('aria-pressed', 'true');
		await screen.getByRole('spinbutton', { name: m.video_editor_duck_amount() }).fill('0');
		await userEvent.keyboard('{Tab}');
		await screen.rerender({ item: timelineStore.itemById.get('voice')! });
		const disclosureButton = screen.container.querySelector('[data-editor-disclosure] button');
		expect(disclosureButton).toBeInstanceOf(HTMLButtonElement);
		if (!(disclosureButton instanceof HTMLButtonElement)) {
			throw new Error('Expected disclosure button');
		}
		await expect.element(disclosureButton).toHaveTextContent(m.video_editor_duck_off());
		await screen.getByText(m.video_editor_duck_title(), { exact: true }).click();
		await expect.element(toggle).toHaveAttribute('aria-pressed', 'false');
		expect(timelineStore.itemById.get('voice')?.audioDucking).toBeUndefined();
		commandHistory.undo();
		await screen.rerender({ item: timelineStore.itemById.get('voice')! });
		await expect.element(toggle).toHaveAttribute('aria-pressed', 'true');
		await expect
			.element(screen.getByRole('spinbutton', { name: m.video_editor_duck_amount() }))
			.toHaveValue(-12);
		expect(timelineStore.itemById.get('voice')?.audioDucking).toEqual({
			duckOthersDb: -12,
			attackSec: 0.2,
			releaseSec: 0.4,
			targetTrackIds: ['music']
		});
		commandHistory.redo();
		const priorRoot = getWorkspaceRoot();
		const opfs = await navigator.storage.getDirectory();
		const directory = `ducking-${crypto.randomUUID()}`;
		setWorkspaceRoot(await opfs.getDirectoryHandle(directory, { create: true }));
		try {
			await createProject({ ...project, timeline: sequenceStore.projectTimeline() });
			sequenceStore.reset();
			const loaded = (await getProject(project.id))!;
			sequenceStore.load(loaded.timeline!, loaded.metadata);
			await screen.rerender({ item: timelineStore.itemById.get('voice')! });
			const reloadedDisclosure = screen.container.querySelector('[data-editor-disclosure] button');
			expect(reloadedDisclosure).toBeInstanceOf(HTMLButtonElement);
			if (!(reloadedDisclosure instanceof HTMLButtonElement)) {
				throw new Error('Expected disclosure button');
			}
			await expect.element(reloadedDisclosure).toHaveTextContent(m.video_editor_duck_off());
			await screen.getByText(m.video_editor_duck_title(), { exact: true }).click();
			await expect.element(toggle).toHaveAttribute('aria-pressed', 'false');
			expect(timelineStore.itemById.get('voice')?.audioDucking).toBeUndefined();
		} finally {
			setWorkspaceRoot(priorRoot);
			await opfs.removeEntry(directory, { recursive: true });
		}
	});
});

describe('AudioEqPanel', () => {
	it('preserves a user-closed bus EQ when its settings refresh', async () => {
		const screen = await render(AudioEqPanel, { open: true, settings: {} });
		const preset = screen.getByLabelText(m.video_editor_audio_eq_preset_aria());
		await expect.element(preset).toBeVisible();
		await screen.getByText(m.video_editor_audio_eq_title(), { exact: true }).click();
		await expect.element(preset).not.toBeVisible();
		await screen.rerender({ settings: { outputGainDb: 1 } });
		await expect.element(preset).not.toBeVisible();
	});

	it('keeps the user-opened EQ and keyboard focus through preset edits and undo', async () => {
		const item: TimelineItem = {
			id: 'audio',
			type: 'audio',
			trackId: 'track-audio',
			label: 'Audio',
			from: 0,
			durationInFrames: 240,
			speed: 2
		};
		timelineStore._setItems([item]);
		commandHistory.clearHistory();
		const screen = await render(AudioEqPanel, { item, onedit: vi.fn() });
		await screen.getByText(m.video_editor_audio_eq_title(), { exact: true }).click();
		const preset = screen.getByLabelText(m.video_editor_audio_eq_preset_aria());
		await preset.click();
		await screen
			.getByRole('option', { name: m.video_editor_audio_eq_preset_voice_clarity(), exact: true })
			.click();
		await screen.rerender({ item: timelineStore.itemById.get(item.id)! });
		await expect.element(preset).toBeVisible();

		const handle = screen.getByRole('button', {
			name: `${m.video_editor_audio_eq_low_mid()} ${m.video_editor_audio_eq_response()}`,
			exact: true
		});
		const previousGain = timelineStore.itemById.get(item.id)?.audioEqLowMidGainDb ?? 0;
		handle.element().focus();
		await userEvent.keyboard('{ArrowUp}');
		await screen.rerender({ item: timelineStore.itemById.get(item.id)! });
		await expect.element(handle).toBeVisible();
		await expect.element(handle).toHaveFocus();
		expect(timelineStore.itemById.get(item.id)).toMatchObject({
			audioEqLowMidGainDb: previousGain + 0.5,
			durationInFrames: 240,
			speed: 2
		});
		commandHistory.undo();
		await screen.rerender({ item: timelineStore.itemById.get(item.id)! });
		await expect.element(handle).toBeVisible();
		expect(timelineStore.itemById.get(item.id)?.audioEqLowMidGainDb).toBe(previousGain);
	});

	it('plots Flat and edited EQ as gain relative to the visible zero dB line', async () => {
		const item: TimelineItem = {
			id: 'audio',
			type: 'audio',
			trackId: 'track-audio',
			label: 'Audio',
			from: 0,
			durationInFrames: 240
		};
		timelineStore._setItems([item]);
		const screen = await render(AudioEqPanel, { item, open: true });
		const preset = screen.getByLabelText(m.video_editor_audio_eq_preset_aria());
		await preset.click();
		await screen.getByRole('option', { name: 'Flat', exact: true }).click();
		await screen.rerender({ item: timelineStore.itemById.get(item.id)! });
		const graph = screen.getByRole('group', {
			name: m.video_editor_audio_eq_response(),
			exact: true
		});
		const handle = graph.getByRole('button', {
			name: `${m.video_editor_audio_eq_low_mid()} ${m.video_editor_audio_eq_response()}`,
			exact: true
		});
		const center = (element: Element) => {
			const rect = element.getBoundingClientRect();
			return rect.top + rect.height / 2;
		};
		const zero = graph.getByText('0', { exact: true });
		expect(Math.abs(center(handle.element()) - center(zero.element()))).toBeLessThan(2);
		await expect
			.element(graph.getByText(m.video_editor_audio_eq_gain(), { exact: true }))
			.toBeVisible();
		const curve = graph.element().querySelector('path')!;
		expect(Math.abs(center(curve) - center(zero.element()))).toBeLessThan(2);
		handle.element().focus();
		await userEvent.keyboard('{ArrowUp}');
		await screen.rerender({ item: timelineStore.itemById.get(item.id)! });
		expect(timelineStore.itemById.get(item.id)?.audioEqLowMidGainDb).toBe(0.5);
		expect(center(handle.element())).toBeLessThan(center(zero.element()));
		await expect.element(handle).toHaveFocus();
		commandHistory.undo();
		await screen.rerender({ item: timelineStore.itemById.get(item.id)! });
		expect(Math.abs(center(handle.element()) - center(zero.element()))).toBeLessThan(2);
		commandHistory.redo();
		await screen.rerender({ item: timelineStore.itemById.get(item.id)! });
		expect(center(handle.element())).toBeLessThan(center(zero.element()));
		await preset.click();
		await screen.getByRole('option', { name: 'Voice clarity', exact: true }).click();
		await screen.rerender({ item: timelineStore.itemById.get(item.id)! });
		expect(timelineStore.itemById.get(item.id)?.audioEqLowMidGainDb).toBe(-2.5);
		const negativeTen = graph.getByText('-10', { exact: true });
		expect(
			(center(handle.element()) - center(zero.element())) /
				(center(negativeTen.element()) - center(zero.element()))
		).toBeCloseTo(0.25, 1);
		await screen.getByText(m.video_editor_audio_eq_low_mid(), { exact: true }).click();
		const band = screen
			.getByText(m.video_editor_audio_eq_low_mid(), { exact: true })
			.element()
			.closest('[data-editor-disclosure]')!;
		const gain = page
			.elementLocator(band)
			.getByRole('spinbutton', { name: m.video_editor_audio_eq_gain(), exact: true });
		await gain.fill('-6');
		await userEvent.keyboard('{Tab}');
		await screen.rerender({ item: timelineStore.itemById.get(item.id)! });
		expect(timelineStore.itemById.get(item.id)?.audioEqLowMidGainDb).toBe(-6);
		expect(
			(center(handle.element()) - center(zero.element())) /
				(center(negativeTen.element()) - center(zero.element()))
		).toBeCloseTo(0.6, 1);
		commandHistory.undo();
		await screen.rerender({ item: timelineStore.itemById.get(item.id)! });
		await expect.element(gain).toHaveValue(-2.5);
		commandHistory.redo();
		await screen.rerender({ item: timelineStore.itemById.get(item.id)! });
		await expect.element(gain).toHaveValue(-6);
	});
});

function audioTrack(id: string, name: string, patch: Partial<TimelineTrack> = {}): TimelineTrack {
	return {
		id,
		name,
		kind: 'audio',
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		volume: 1,
		order: 0,
		...patch
	};
}

function pointer(type: string, y: number, pointerId: number): PointerEvent {
	return new PointerEvent(type, {
		bubbles: true,
		button: type === 'pointerdown' ? 0 : undefined,
		buttons: type === 'pointermove' ? 1 : 0,
		clientX: 122,
		clientY: y,
		pointerId,
		pointerType: 'mouse'
	});
}

describe('AudioMixerPanel', () => {
	beforeEach(async () => {
		await page.viewport(1280, 900);
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
		timelineStore.setAll({
			tracks: [audioTrack('dialogue', 'Dialogue'), audioTrack('music', 'Music', { locked: true })],
			items: [],
			masterVolumeDb: 0,
			masterMuted: false
		});
	});

	it('exposes vertical decibel faders with consistent keyboard limits', async () => {
		const screen = await render(AudioMixerPanel);
		for (const name of ['Dialogue volume', 'Master output volume']) {
			const fader = screen.getByRole('slider', { name, exact: true });
			await expect.element(fader).toHaveAttribute('aria-orientation', 'vertical');
			await expect.element(fader).toHaveAttribute('aria-valuetext', '+0.0 dB');
			fader.element().focus();
			await userEvent.keyboard('{ArrowDown}');
			await expect
				.poll(() => Number(fader.element().getAttribute('aria-valuenow')))
				.toBeCloseTo(-1, 8);
			await expect.element(fader).toHaveAttribute('aria-valuetext', '-1.0 dB');
			await userEvent.keyboard('{ArrowRight}');
			await expect
				.poll(() => Number(fader.element().getAttribute('aria-valuenow')))
				.toBeCloseTo(0, 8);
			await userEvent.keyboard('{Home}');
			await expect
				.poll(() => Number(fader.element().getAttribute('aria-valuenow')))
				.toBeCloseTo(-60, 8);
			await expect.element(fader).toHaveAttribute('aria-valuetext', '-inf dB');
			await userEvent.keyboard('{ArrowLeft}');
			await expect
				.poll(() => Number(fader.element().getAttribute('aria-valuenow')))
				.toBeCloseTo(-60, 8);
			await userEvent.keyboard('{End}');
			await expect
				.poll(() => Number(fader.element().getAttribute('aria-valuenow')))
				.toBeCloseTo(12, 8);
			await userEvent.keyboard('{ArrowUp}');
			await expect
				.poll(() => Number(fader.element().getAttribute('aria-valuenow')))
				.toBeCloseTo(12, 8);
			expect(document.activeElement).toBe(fader.element());
		}
	});

	it('commits one pointer gesture, cancels Escape, and supports one-step undo', async () => {
		const screen = await render(AudioMixerPanel);
		const fader = screen.getByRole('slider', { name: 'Dialogue volume' }).element();
		vi.spyOn(fader, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 44, 100));
		vi.spyOn(fader, 'setPointerCapture').mockImplementation(() => undefined);
		vi.spyOn(fader, 'hasPointerCapture').mockReturnValue(true);
		vi.spyOn(fader, 'releasePointerCapture').mockImplementation(() => undefined);

		fader.dispatchEvent(pointer('pointerdown', 117, 1));
		fader.dispatchEvent(pointer('pointermove', 150, 1));
		fader.dispatchEvent(pointer('pointerup', 150, 1));
		await vi.waitFor(() => expect(timelineStore.tracks[0]?.volume).toBeLessThan(1));
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.tracks[0]?.volume).toBe(1);

		fader.dispatchEvent(pointer('pointerdown', 117, 2));
		fader.dispatchEvent(pointer('pointermove', 180, 2));
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		fader.dispatchEvent(pointer('pointerup', 180, 2));
		expect(timelineStore.tracks[0]?.volume).toBe(1);
		expect(commandHistory.undoStack).toHaveLength(0);
	});

	it('keeps channel, master, locked-track, and narrow layout behavior intact', async () => {
		await page.viewport(320, 720);
		const screen = await render(AudioMixerPanel);
		await screen.getByRole('button', { name: 'Mute Dialogue' }).click();
		expect(timelineStore.tracks[0]?.muted).toBe(true);

		const fader = screen.getByRole('slider', { name: 'Dialogue volume' });
		fader.element().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
		expect(timelineStore.tracks[0]?.volume).toBeCloseTo(Math.pow(10, 1 / 20), 8);

		await screen.getByRole('button', { name: 'Mute master output' }).click();
		expect(timelineStore.masterMuted).toBe(true);
		await expect.element(screen.getByRole('button', { name: 'Mute Music' })).toBeDisabled();
		await expect
			.element(screen.getByRole('slider', { name: 'Music volume' }))
			.toHaveAttribute('tabindex', '-1');

		const panel = screen.container.querySelector<HTMLElement>('[data-audio-mixer]')!;
		expect(panel.clientWidth).toBeLessThanOrEqual(320);
		expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
		expect(panel.querySelector('[data-mixer-master]')).not.toBeNull();
	});
});

describe('LocalMusicPanel', () => {
	it('shows the selected Music starting point while keeping its brief editable', async () => {
		const inserted = vi.fn();
		let screen = await render(LocalMusicPanel, {
			projectId: 'music-preset',
			oninserted: inserted,
			supported: false
		});
		const startingPoint = screen.getByRole('button', { name: 'Starting point', exact: true });
		const brief = screen.getByRole('textbox', { name: 'Music brief', exact: true });
		try {
			await expect.element(startingPoint).toHaveTextContent('Cinematic pulse');
			await startingPoint.click();
			await page.getByRole('option', { name: 'Ambient bed', exact: true }).click();
			await expect
				.element(brief)
				.toHaveValue(
					'Calm ambient instrumental, warm pads, sparse piano, gentle motion, no percussion'
				);
			await expect.element(startingPoint).toHaveTextContent('Ambient bed');
			startingPoint.element().focus();
			await userEvent.keyboard('{Enter}{End}{Enter}');
			await expect.element(startingPoint).toHaveTextContent('Lo-fi beat');
			await expect
				.element(brief)
				.toHaveValue(
					'Relaxed lo-fi hip hop instrumental, dusty drums, warm keys, subtle vinyl texture'
				);
			await brief.fill('My own instrumental brief');
			await expect.element(startingPoint).toHaveTextContent('Lo-fi beat');
			await startingPoint.click();
			await page.getByRole('option', { name: 'Cinematic pulse', exact: true }).click();
			await expect.element(startingPoint).toHaveTextContent('Cinematic pulse');
			await expect
				.element(brief)
				.toHaveValue(
					'Cinematic electronic instrumental, rising pulse, deep drums, clear edit points, polished mix'
				);
			expect(inserted).not.toHaveBeenCalled();
			await screen.unmount();
			screen = await render(LocalMusicPanel, {
				projectId: 'music-preset',
				oninserted: inserted,
				supported: false
			});
			await expect
				.element(screen.getByRole('button', { name: 'Starting point', exact: true }))
				.toHaveTextContent('Cinematic pulse');
			await expect
				.element(screen.getByRole('textbox', { name: 'Music brief', exact: true }))
				.toHaveValue(
					'Cinematic electronic instrumental, rising pulse, deep drums, clear edit points, polished mix'
				);
		} finally {
			await screen.unmount();
		}
	});
});
