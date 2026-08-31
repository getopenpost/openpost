import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { resolveAnimatedItemAt } from '$lib/video-editor/timeline/animated-properties';
import { mediaPool } from '$lib/video-editor/media/pool.svelte';
import ClipPropertiesPanel from './clip-properties-panel.svelte';
import '../../../routes/layout.css';

const tracks: TimelineTrack[] = [
	{
		id: 'video',
		name: 'Video 1',
		kind: 'video',
		height: 96,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order: 0
	},
	{
		id: 'audio',
		name: 'Audio 1',
		kind: 'audio',
		height: 72,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order: 1
	}
];

const items: TimelineItem[] = [
	{
		id: 'video-item',
		trackId: 'video',
		from: 0,
		durationInFrames: 90,
		label: 'Interview',
		type: 'video',
		mediaId: 'media',
		linkedGroupId: 'linked',
		sourceStart: 30,
		sourceEnd: 120,
		sourceFps: 30,
		sourceWidth: 640,
		sourceHeight: 360,
		transform: { x: 100, y: 20, width: 640, height: 360, opacity: 0.6, cornerRadius: 20 }
	},
	{
		id: 'audio-item',
		trackId: 'audio',
		from: 0,
		durationInFrames: 90,
		label: 'Interview audio',
		type: 'audio',
		mediaId: 'media',
		linkedGroupId: 'linked',
		sourceStart: 30,
		sourceEnd: 120,
		sourceFps: 30
	},
	{
		id: 'text-item',
		trackId: 'video',
		from: 120,
		durationInFrames: 90,
		label: 'Launch',
		text: 'Launch',
		type: 'text',
		backgroundColor: '#221100',
		fontSize: 84,
		fontWeight: 700,
		transform: {
			x: -20,
			y: 20,
			width: 300,
			height: 100,
			aspectRatioLocked: false
		},
		blendMode: 'multiply'
	}
];

beforeEach(() => {
	mediaPool.clear();
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks, items, currentFrame: 0, fps: 30 });
	commandHistory.clearHistory();
});

afterEach(async () => {
	await page.viewport(1280, 900);
});

describe('ClipPropertiesPanel animated image playback', () => {
	it('changes GIF speed without stretching the clip and reverses the loop', async () => {
		mediaPool.loadAll([
			{
				id: 'animated-media',
				storageType: 'workspace',
				fileName: 'reaction.gif',
				fileSize: 1024,
				mimeType: 'image/gif',
				duration: 0.6,
				width: 320,
				height: 180,
				fps: 10,
				codec: '',
				bitrate: 0,
				animationFrameCount: 6,
				tags: ['image']
			}
		]);
		timelineStore._addItem({
			id: 'animated-image',
			trackId: 'video',
			from: 0,
			durationInFrames: 150,
			label: 'reaction.gif',
			type: 'image',
			mediaId: 'animated-media',
			sourceWidth: 320,
			sourceHeight: 180
		});
		commandHistory.clearHistory();
		const onedit = vi.fn();
		const screen = await render(ClipPropertiesPanel, {
			itemId: 'animated-image',
			onedit
		});

		const speed = screen.getByRole('textbox', { name: 'Speed' }).query();
		if (!(speed instanceof HTMLInputElement)) throw new Error('GIF speed control did not render.');
		speed.value = '2.5';
		speed.dispatchEvent(new InputEvent('input', { bubbles: true, data: '2.5' }));
		speed.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
		expect(timelineStore.itemById.get('animated-image')).toMatchObject({
			speed: 2.5,
			durationInFrames: 150
		});
		expect(commandHistory.getLastCommandType()).toBe('SET_ANIMATED_IMAGE_SPEED');

		await screen.getByRole('button', { name: 'Reverse clip' }).click();
		expect(timelineStore.itemById.get('animated-image')?.isReversed).toBe(true);
		expect(commandHistory.getLastCommandType()).toBe('SET_ANIMATED_IMAGES_REVERSED');
		expect(onedit).toHaveBeenCalledTimes(2);

		const panel = screen.getByTestId('animated-image-playback-section').query();
		panel.style.width = '320px';
		panel.style.background = 'oklch(0.15 0.008 55)';
		expect(panel.scrollWidth).toBeLessThanOrEqual(320);
		await page.screenshot({
			element: panel,
			path: '../../../../.svelte-kit/openpost-animated-image-playback.png'
		});
	});
});

describe('ClipPropertiesPanel reverse playback', () => {
	it('shows the playback state and reverses linked A/V in one undoable edit', async () => {
		const onedit = vi.fn();
		const screen = await render(ClipPropertiesPanel, {
			itemId: 'video-item',
			onedit
		});
		const reverse = screen.getByRole('button', { name: 'Reverse clip' });

		await expect.element(reverse).toHaveAttribute('aria-pressed', 'false');
		await reverse.click();

		await expect.element(reverse).toHaveAttribute('aria-pressed', 'true');
		expect(timelineStore.items.map((item) => item.isReversed)).toEqual([true, true, undefined]);
		expect(onedit).toHaveBeenCalledOnce();
		expect(commandHistory.getLastCommandType()).toBe('SET_ITEMS_REVERSED');

		commandHistory.undo();
		expect(timelineStore.items.map((item) => item.isReversed)).toEqual([
			undefined,
			undefined,
			undefined
		]);
	});

	it('retimes linked media and edits the audible companion from the video inspector', async () => {
		const onedit = vi.fn();
		const screen = await render(ClipPropertiesPanel, {
			itemId: 'video-item',
			onedit
		});

		const speed = screen.getByRole('textbox', { name: 'Speed' }).query();
		if (!(speed instanceof HTMLInputElement)) throw new Error('Speed control did not render.');
		speed.value = '2';
		speed.dispatchEvent(new InputEvent('input', { bubbles: true, data: '2' }));
		speed.dispatchEvent(new FocusEvent('blur', { bubbles: true }));

		expect(timelineStore.itemById.get('video-item')).toMatchObject({
			speed: 2,
			durationInFrames: 45
		});
		expect(timelineStore.itemById.get('audio-item')).toMatchObject({
			speed: 2,
			durationInFrames: 45
		});
		const gain = screen.getByRole('textbox', { name: 'Gain (dB)' }).query();
		if (!(gain instanceof HTMLInputElement)) throw new Error('Gain control did not render.');
		gain.value = '-6';
		gain.dispatchEvent(new InputEvent('input', { bubbles: true, data: '-6' }));
		gain.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
		expect(timelineStore.itemById.get('audio-item')?.volume).toBeCloseTo(0.501187, 5);
		expect(timelineStore.itemById.get('video-item')?.volume).toBeUndefined();

		const semitones = screen.getByRole('textbox', { name: 'Semitones' }).query();
		const cents = screen.getByRole('textbox', { name: 'Cents' }).query();
		if (!(semitones instanceof HTMLInputElement) || !(cents instanceof HTMLInputElement)) {
			throw new Error('Pitch controls did not render.');
		}
		semitones.value = '3';
		semitones.dispatchEvent(new InputEvent('input', { bubbles: true, data: '3' }));
		semitones.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
		cents.value = '25';
		cents.dispatchEvent(new InputEvent('input', { bubbles: true, data: '25' }));
		cents.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
		expect(timelineStore.itemById.get('audio-item')).toMatchObject({
			audioPitchSemitones: 3,
			audioPitchCents: 25
		});

		await screen.getByText('Parametric EQ', { exact: true }).click();
		await screen.getByRole('button', { name: 'EQ preset' }).click();
		await screen.getByRole('option', { name: 'Voice Clarity' }).click();
		expect(timelineStore.itemById.get('audio-item')).toMatchObject({
			audioEqEnabled: true,
			audioEqBand1Enabled: true,
			audioEqBand1FrequencyHz: 80,
			audioEqHighMidGainDb: 4.5,
			audioEqHighFrequencyHz: 7200
		});
		screen.container.style.width = '304px';
		expect(screen.container.firstElementChild?.scrollWidth ?? 0).toBeLessThanOrEqual(304);

		await screen.getByRole('button', { name: 'Flip X' }).click();
		expect(timelineStore.itemById.get('video-item')?.transform?.flipHorizontal).toBe(true);
		expect(onedit).toHaveBeenCalledTimes(6);
	});

	it('rate-stretches a mixed multi-clip selection and commits each gesture once', async () => {
		const secondVideo: TimelineItem = {
			id: 'video-item-2',
			trackId: 'video',
			from: 120,
			durationInFrames: 180,
			label: 'B-roll',
			type: 'video',
			sourceStart: 0,
			sourceEnd: 90,
			sourceFps: 30,
			speed: 0.5,
			sourceWidth: 1280,
			sourceHeight: 720,
			fadeIn: 0.5
		};
		timelineStore.setAll({
			tracks,
			items: [...items, secondVideo],
			currentFrame: 0,
			fps: 30
		});
		const onedit = vi.fn();
		const screen = await render(ClipPropertiesPanel, {
			itemId: 'video-item',
			itemIds: ['video-item', 'video-item-2'],
			onedit
		});
		const speed = screen.getByRole('textbox', { name: 'Speed' }).query();
		if (!(speed instanceof HTMLInputElement)) throw new Error('Speed control did not render.');
		expect(speed.placeholder).toBe('Mixed');
		speed.value = '2';
		speed.dispatchEvent(new InputEvent('input', { bubbles: true, data: '2' }));
		speed.dispatchEvent(new FocusEvent('blur', { bubbles: true }));

		expect(timelineStore.itemById.get('video-item')).toMatchObject({
			speed: 2,
			durationInFrames: 45
		});
		expect(timelineStore.itemById.get('audio-item')).toMatchObject({
			speed: 2,
			durationInFrames: 45
		});
		expect(timelineStore.itemById.get('video-item-2')).toMatchObject({
			speed: 2,
			durationInFrames: 45
		});
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.itemById.get('video-item')?.durationInFrames).toBe(90);
		expect(timelineStore.itemById.get('video-item-2')?.durationInFrames).toBe(180);

		commandHistory.clearHistory();
		const fadeIn = screen
			.getByTestId('clip-playback-section')
			.getByRole('textbox', { name: 'Fade in (s)' })
			.query();
		if (!(fadeIn instanceof HTMLInputElement)) throw new Error('Fade control did not render.');
		expect(fadeIn.placeholder).toBe('Mixed');
		fadeIn.value = '1';
		fadeIn.dispatchEvent(new InputEvent('input', { bubbles: true, data: '1' }));
		fadeIn.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
		expect(timelineStore.itemById.get('video-item')?.fadeIn).toBe(1);
		expect(timelineStore.itemById.get('video-item-2')?.fadeIn).toBe(1);
		expect(commandHistory.undoStack).toHaveLength(1);

		const panel = screen.getByTestId('clip-playback-section').query();
		panel.style.width = '288px';
		expect(panel.scrollWidth).toBeLessThanOrEqual(288);
	});

	it('authors an accessible speed curve for linked picture and sound', async () => {
		timelineStore._setCurrentFrame(30);
		const onedit = vi.fn();
		const screen = await render(ClipPropertiesPanel, {
			itemId: 'video-item',
			itemIds: ['video-item', 'audio-item'],
			onedit
		});

		await screen.getByRole('button', { name: 'Add point' }).click();
		const speedPoint = screen.getByRole('spinbutton', { name: 'Speed 2' }).query();
		if (!(speedPoint instanceof HTMLInputElement)) {
			throw new Error('The speed point control did not render.');
		}
		speedPoint.value = '2';
		speedPoint.dispatchEvent(new Event('change', { bubbles: true }));
		await screen.getByRole('button', { name: 'Easing for segment starting at frame 60' }).click();
		await screen.getByRole('option', { name: 'Hold' }).click();

		const video = timelineStore.itemById.get('video-item');
		const audio = timelineStore.itemById.get('audio-item');
		expect(video?.speedRamp).toEqual(audio?.speedRamp);
		expect(video?.speedRamp?.find((point) => point.sourceFrame === 60)).toMatchObject({
			speed: 2,
			easing: 'hold'
		});
		expect(video?.durationInFrames).toBe(51);
		expect(audio?.durationInFrames).toBe(51);
		expect(onedit).toHaveBeenCalledTimes(3);

		const editor = screen.getByTestId('speed-ramp-editor').query();
		editor.style.width = '280px';
		expect(editor.scrollWidth).toBeLessThanOrEqual(280);
		await page.screenshot({
			element: editor,
			path: '../../../../.svelte-kit/openpost-speed-ramp-editor.png'
		});
	});
});

describe('ClipPropertiesPanel transform workflow', () => {
	it('edits pixel values across a mixed selection in one undoable operation', async () => {
		await page.viewport(420, 900);
		const onedit = vi.fn();
		const screen = await render(ClipPropertiesPanel, {
			itemId: 'video-item',
			itemIds: ['video-item', 'text-item'],
			onedit
		});
		screen.container.style.width = '360px';
		screen.container.style.background = 'oklch(0.15 0.008 55)';
		if (screen.container.firstElementChild instanceof HTMLElement) {
			screen.container.firstElementChild.style.width = '360px';
		}
		const transformPanel = screen.getByTestId('clip-transform-panel').query();
		transformPanel.style.width = '360px';
		transformPanel.style.background = 'oklch(0.15 0.008 55)';

		await expect.element(screen.getByText('Position', { exact: true })).toBeVisible();
		await expect.element(screen.getByText('Size', { exact: true })).toBeVisible();
		await expect.element(screen.getByText('Anchor', { exact: true })).toBeVisible();
		const position = screen.getByRole('textbox', { name: 'Horizontal position' }).query();
		if (!(position instanceof HTMLInputElement))
			throw new Error('Position control did not render.');
		expect(position.placeholder).toBe('Mixed');
		await page.screenshot({
			element: screen.getByTestId('clip-transform-panel').element(),
			path: '../../../../.svelte-kit/openpost-clip-transform-mixed.png'
		});
		position.value = '240';
		position.dispatchEvent(new InputEvent('input', { bubbles: true, data: '240' }));
		position.dispatchEvent(new FocusEvent('blur', { bubbles: true }));

		expect(timelineStore.itemById.get('video-item')?.transform?.x).toBe(240);
		expect(timelineStore.itemById.get('text-item')?.transform?.x).toBe(240);
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(commandHistory.getLastCommandType()).toBe('SET_ANIMATED_PROPERTIES');
		commandHistory.undo();
		expect(timelineStore.itemById.get('video-item')?.transform?.x).toBe(100);
		expect(timelineStore.itemById.get('text-item')?.transform?.x).toBe(-20);

		commandHistory.clearHistory();
		await screen.getByRole('button', { name: 'Blend mode' }).click();
		await screen.getByRole('option', { name: 'Contrast: Overlay' }).click();
		expect(timelineStore.itemById.get('video-item')?.blendMode).toBe('overlay');
		expect(timelineStore.itemById.get('text-item')?.blendMode).toBe('overlay');
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.itemById.get('video-item')?.blendMode).toBeUndefined();
		expect(timelineStore.itemById.get('text-item')?.blendMode).toBe('multiply');

		screen.container.style.width = '288px';
		if (screen.container.firstElementChild instanceof HTMLElement) {
			screen.container.firstElementChild.style.width = '288px';
		}
		screen.getByTestId('clip-transform-panel').query().style.width = '288px';
		expect(screen.getByTestId('clip-transform-section').query().scrollWidth).toBeLessThanOrEqual(
			288
		);
	});

	it('keeps linked dimensions proportional and resets position as atomic edits', async () => {
		await page.viewport(420, 900);
		const onedit = vi.fn();
		const screen = await render(ClipPropertiesPanel, {
			itemId: 'video-item',
			itemIds: ['video-item'],
			onedit
		});
		screen.container.style.width = '360px';
		screen.container.style.background = 'oklch(0.15 0.008 55)';
		if (screen.container.firstElementChild instanceof HTMLElement) {
			screen.container.firstElementChild.style.width = '360px';
		}
		const transformPanel = screen.getByTestId('clip-transform-panel').query();
		transformPanel.style.width = '360px';
		transformPanel.style.background = 'oklch(0.15 0.008 55)';
		await expect
			.element(screen.getByRole('button', { name: 'Unlock aspect ratio' }))
			.toHaveAttribute('aria-pressed', 'true');

		const width = screen.getByRole('textbox', { name: 'Width' }).query();
		if (!(width instanceof HTMLInputElement)) throw new Error('Width control did not render.');
		width.value = '1280';
		width.dispatchEvent(new InputEvent('input', { bubbles: true, data: '1280' }));
		width.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
		expect(timelineStore.itemById.get('video-item')?.transform).toMatchObject({
			width: 1280,
			height: 720
		});
		expect(commandHistory.undoStack).toHaveLength(1);
		await page.screenshot({
			element: screen.getByTestId('clip-transform-panel').element(),
			path: '../../../../.svelte-kit/openpost-clip-transform-linked.png'
		});

		commandHistory.clearHistory();
		await screen.getByRole('button', { name: 'Reset position' }).click();
		expect(timelineStore.itemById.get('video-item')?.transform).toMatchObject({
			x: 0,
			y: 0
		});
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.itemById.get('video-item')?.transform).toMatchObject({
			x: 100,
			y: 20
		});

		commandHistory.clearHistory();
		await screen.getByRole('button', { name: 'Reset opacity' }).click();
		expect(timelineStore.itemById.get('video-item')?.transform?.opacity).toBe(1);
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.clearHistory();
		await screen.getByRole('button', { name: 'Reset radius' }).click();
		expect(timelineStore.itemById.get('video-item')?.transform?.cornerRadius).toBe(0);
		expect(commandHistory.undoStack).toHaveLength(1);
	});
});

describe('ClipPropertiesPanel crop workflow', () => {
	it('edits source pixels across different media sizes as one undoable operation', async () => {
		await page.viewport(420, 1000);
		const image: TimelineItem = {
			id: 'image-item',
			trackId: 'video',
			from: 0,
			durationInFrames: 90,
			label: 'Still',
			type: 'image',
			sourceWidth: 1280,
			sourceHeight: 720,
			crop: { top: 0, right: 0, bottom: 0, left: 0.125 }
		};
		const video = {
			...items[0]!,
			crop: { top: 0, right: 0, bottom: 0, left: 0.25 }
		};
		timelineStore.setAll({
			tracks,
			items: [video, items[1]!, items[2]!, image],
			currentFrame: 0,
			fps: 30
		});
		const onedit = vi.fn();
		const screen = await render(ClipPropertiesPanel, {
			itemId: 'video-item',
			itemIds: ['video-item', 'image-item'],
			onedit
		});
		screen.container.style.width = '360px';
		const panel = screen.getByTestId('clip-crop-section').query();
		panel.style.width = '360px';
		panel.style.background = 'oklch(0.15 0.008 55)';

		const left = screen.getByRole('textbox', { name: 'Left' }).query();
		if (!(left instanceof HTMLInputElement)) throw new Error('Left crop control did not render.');
		expect(left.value).toBe('160');
		await page.screenshot({
			element: panel,
			path: '../../../../.svelte-kit/openpost-clip-crop-source-pixels.png'
		});
		left.value = '320';
		left.dispatchEvent(new InputEvent('input', { bubbles: true, data: '320' }));
		left.dispatchEvent(new FocusEvent('blur', { bubbles: true }));

		expect(timelineStore.itemById.get('video-item')?.crop?.left).toBe(0.5);
		expect(timelineStore.itemById.get('image-item')?.crop?.left).toBe(0.25);
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(commandHistory.getLastCommandType()).toBe('SET_ANIMATED_PROPERTIES');
		commandHistory.undo();
		expect(timelineStore.itemById.get('video-item')?.crop?.left).toBe(0.25);
		expect(timelineStore.itemById.get('image-item')?.crop?.left).toBe(0.125);

		commandHistory.clearHistory();
		await screen.getByRole('button', { name: 'Reset Left' }).click();
		expect(timelineStore.itemById.get('video-item')?.crop?.left).toBe(0);
		expect(timelineStore.itemById.get('image-item')?.crop?.left).toBe(0);
		expect(commandHistory.undoStack).toHaveLength(1);

		screen.container.style.width = '288px';
		panel.style.width = '288px';
		expect(panel.scrollWidth).toBeLessThanOrEqual(288);
	});

	it('stores auto-keyed crop values in pixels and resolves them to render ratios', async () => {
		const onedit = vi.fn();
		const screen = await render(ClipPropertiesPanel, {
			itemId: 'video-item',
			itemIds: ['video-item'],
			onedit
		});
		await screen.getByRole('button', { name: 'Toggle auto-key for Left' }).click();
		const left = screen.getByRole('textbox', { name: 'Left' }).query();
		if (!(left instanceof HTMLInputElement)) throw new Error('Left crop control did not render.');
		left.value = '160';
		left.dispatchEvent(new InputEvent('input', { bubbles: true, data: '160' }));
		left.dispatchEvent(new FocusEvent('blur', { bubbles: true }));

		expect(timelineStore.itemById.get('video-item')?.keyframes?.cropLeft?.values).toEqual([160]);
		expect(resolveAnimatedItemAt(timelineStore.itemById.get('video-item')!, 0).crop?.left).toBe(
			0.25
		);
	});
});

describe('ClipPropertiesPanel audio workflow', () => {
	it('edits selected audio clips together with mixed values and one undo entry', async () => {
		const secondAudio: TimelineItem = {
			id: 'audio-item-2',
			trackId: 'audio',
			from: 0,
			durationInFrames: 90,
			label: 'Room tone',
			type: 'audio',
			volume: 0.5,
			audioFadeIn: 0.5
		};
		timelineStore.setAll({
			tracks,
			items: [...items, secondAudio],
			currentFrame: 0,
			fps: 30
		});
		const onedit = vi.fn();
		const screen = await render(ClipPropertiesPanel, {
			itemId: 'audio-item',
			itemIds: ['audio-item', 'audio-item-2'],
			onedit
		});
		const panel = screen.getByTestId('clip-audio-core-section');
		const gain = panel.getByRole('textbox', { name: 'Gain (dB)' }).query();
		if (!(gain instanceof HTMLInputElement)) throw new Error('Gain control did not render.');
		expect(gain.placeholder).toBe('Mixed');
		gain.value = '-6';
		gain.dispatchEvent(new InputEvent('input', { bubbles: true, data: '-6' }));
		gain.dispatchEvent(new FocusEvent('blur', { bubbles: true }));

		expect(timelineStore.itemById.get('audio-item')?.volume).toBeCloseTo(0.501187, 5);
		expect(timelineStore.itemById.get('audio-item-2')?.volume).toBeCloseTo(0.501187, 5);
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.itemById.get('audio-item')?.volume).toBeUndefined();
		expect(timelineStore.itemById.get('audio-item-2')?.volume).toBe(0.5);

		commandHistory.clearHistory();
		const fade = panel.getByRole('textbox', { name: 'Fade in (s)' }).query();
		if (!(fade instanceof HTMLInputElement)) throw new Error('Audio fade control did not render.');
		expect(fade.placeholder).toBe('Mixed');
		fade.value = '1';
		fade.dispatchEvent(new InputEvent('input', { bubbles: true, data: '1' }));
		fade.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
		expect(timelineStore.itemById.get('audio-item')?.audioFadeIn).toBe(1);
		expect(timelineStore.itemById.get('audio-item-2')?.audioFadeIn).toBe(1);
		expect(commandHistory.undoStack).toHaveLength(1);

		panel.query().style.width = '288px';
		expect(panel.query().scrollWidth).toBeLessThanOrEqual(288);
	});
});

describe('ClipPropertiesPanel noise reduction draft/commit', () => {
	it('keeps slider drags as draft and commits exactly one undoable action on release', async () => {
		const onedit = vi.fn();
		const screen = await render(ClipPropertiesPanel, {
			itemId: 'audio-item',
			onedit
		});
		const panel = screen.getByTestId('noise-reduction-panel');
		await expect.element(panel).toBeInTheDocument();
		// SAFETY: checkbox is bits-ui primitive rendered as button
		const enableCheckbox = panel
			.query()
			.querySelector('button[role="checkbox"]') as HTMLElement | null;
		if (!enableCheckbox) throw new Error('Enable checkbox did not render');
		await enableCheckbox.click();
		expect(timelineStore.itemById.get('audio-item')?.audioNoiseReductionEnabled).toBe(true);
		expect(commandHistory.undoStack.length).toBe(1);
		commandHistory.clearHistory();
		const slider = screen.getByRole('slider', {
			name: 'Noise reduction strength'
		});
		await expect.element(slider).toBeInTheDocument();
		await expect.element(slider).toBeEnabled();
		slider.element().focus();
		const { userEvent } = await import('vitest/browser');
		await userEvent.keyboard('{ArrowRight>4/}');
		await expect.element(slider).toHaveAttribute('aria-valuenow', '54');
		// Exactly one undoable action after the gesture, not four
		expect(commandHistory.undoStack.length).toBe(1);
		expect(commandHistory.getLastCommandType()).toBe('UPDATE_CLIP_AUDIO');
		expect(timelineStore.itemById.get('audio-item')?.audioNoiseReductionAmount).toBe(54);
		commandHistory.undo();
		expect(timelineStore.itemById.get('audio-item')?.audioNoiseReductionAmount).toBe(50);
	});
});

describe('ClipPropertiesPanel text styling', () => {
	it('edits complete block typography without losing related shadow values', async () => {
		const onedit = vi.fn();
		const screen = await render(ClipPropertiesPanel, {
			itemId: 'text-item',
			onedit
		});

		const shadowX = screen.getByRole('spinbutton', { name: 'Shadow X' }).query();
		if (!(shadowX instanceof HTMLInputElement)) {
			throw new Error('Shadow X control did not render.');
		}
		shadowX.value = '12';
		shadowX.dispatchEvent(new Event('change', { bubbles: true }));

		const shadowY = screen.getByRole('spinbutton', { name: 'Shadow Y' }).query();
		if (!(shadowY instanceof HTMLInputElement)) {
			throw new Error('Shadow Y control did not render.');
		}
		shadowY.value = '18';
		shadowY.dispatchEvent(new Event('change', { bubbles: true }));

		const shadowBlur = screen.getByRole('spinbutton', { name: 'Shadow blur' }).query();
		if (!(shadowBlur instanceof HTMLInputElement)) {
			throw new Error('Shadow blur control did not render.');
		}
		shadowBlur.value = '24';
		shadowBlur.dispatchEvent(new Event('change', { bubbles: true }));

		const shadowColor = screen.getByLabelText('Shadow color').query();
		if (!(shadowColor instanceof HTMLInputElement)) {
			throw new Error('Shadow color control did not render.');
		}
		shadowColor.value = '#336699';
		shadowColor.dispatchEvent(new Event('change', { bubbles: true }));

		await screen.getByRole('button', { name: 'Alignment', exact: true }).click();
		await screen.getByRole('option', { name: 'Left', exact: true }).click();
		await screen.getByRole('button', { name: 'Vertical alignment', exact: true }).click();
		await screen.getByRole('option', { name: 'Bottom', exact: true }).click();
		await screen.getByRole('button', { name: 'Clear background' }).click();

		expect(timelineStore.itemById.get('text-item')).toMatchObject({
			backgroundColor: undefined,
			textAlign: 'left',
			verticalAlign: 'bottom',
			textShadow: { blur: 24, color: '#336699', offsetX: 12, offsetY: 18 }
		});
		expect(commandHistory.canUndo).toBe(true);
		expect(onedit).toHaveBeenCalledTimes(7);

		screen.container.style.width = '260px';
		const panel = screen.container.firstElementChild;
		expect(panel).not.toBeNull();
		if (panel) expect(panel.scrollWidth).toBeLessThanOrEqual(260);
	});
});
