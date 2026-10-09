import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { updateItemProperties } from '../timeline/actions/items';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { userEvent } from 'vitest/browser';
import { readMixerMasterLevels } from '../audio/audio-mixer';
import { previewAudioContext } from '../audio/reverse-preview-audio';
import { render } from 'vitest-browser-svelte';
import PreviewMixEntryLayer from './preview-mix-entry-layer.svelte';
import PreviewAudioLayer from './preview-audio-layer.svelte';
import { planNestedMixdown } from '../media/render-plan';
import { createDefaultTracks } from '../project/defaults';
import type { TimelineItem } from '../project/types';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { editorSession } from '../editor.svelte';
import { disposeNoiseReductionPreviewWorker } from '../audio/audio-noise-reduction-preview';
import fixtureUrl from '../../../../../../tests/app/fixtures/product-demos/tutorial-music.wav?url';

const tracks = createDefaultTracks();
const clip: TimelineItem = {
	id: 'sound',
	type: 'audio',
	trackId: 'track-audio',
	mediaId: 'sound',
	label: 'Sound',
	from: 0,
	durationInFrames: 300
};

function nestedEntry(patch: Partial<TimelineItem>, wrapperPatch: Partial<TimelineItem> = {}) {
	return planNestedMixdown(
		[
			{ ...clip, ...wrapperPatch, type: 'composition', compositionId: 'nested', mediaId: undefined }
		],
		tracks,
		30,
		[],
		[
			{
				id: 'nested',
				name: 'Nested sound',
				width: 16,
				height: 16,
				fps: 30,
				durationInFrames: 300,
				tracks,
				items: [{ ...clip, ...patch }],
				transitions: []
			}
		]
	)[0]!;
}

function noisyTone(): Blob {
	const sampleRate = 48000;
	const buffer = new ArrayBuffer(44 + sampleRate * 2);
	const view = new DataView(buffer);
	const text = (offset: number, value: string) => {
		for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
	};
	text(0, 'RIFF');
	view.setUint32(4, buffer.byteLength - 8, true);
	text(8, 'WAVE');
	text(12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	text(36, 'data');
	view.setUint32(40, sampleRate * 2, true);
	let seed = 42;
	for (let i = 0; i < sampleRate; i++) {
		seed = (seed * 1664525 + 1013904223) >>> 0;
		const sample =
			0.4 * Math.sin((2 * Math.PI * 1000 * i) / sampleRate) + ((seed / 4294967296) * 2 - 1) * 0.18;
		view.setInt16(44 + i * 2, Math.round(sample * 32767), true);
	}
	return new Blob([buffer], { type: 'audio/wav' });
}

interface WorkletMessage {
	type: string;
	leftChannel?: ArrayBuffer;
	frame?: number;
	direction?: number;
	tempo?: number;
	sampleRate?: number;
}

function captureWorkletMessages(): WorkletMessage[] {
	const messages: WorkletMessage[] = [];
	const NativeWorklet = AudioWorkletNode;
	vi.stubGlobal(
		'AudioWorkletNode',
		class extends NativeWorklet {
			constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
				super(context, name, options);
				const send = this.port.postMessage.bind(this.port);
				this.port.postMessage = (
					message: WorkletMessage,
					transfer: Transferable[] | StructuredSerializeOptions = []
				) => {
					messages.push(structuredClone(message));
					if (Array.isArray(transfer)) send(message, transfer);
					else send(message, transfer);
				};
			}
		}
	);
	return messages;
}

async function startAudiblePlayback(): Promise<void> {
	const play = document.createElement('button');
	play.textContent = 'Start audio';
	play.onclick = () => editorSession.startPlayback({ start: 0, end: 300 });
	document.body.append(play);
	try {
		await userEvent.click(play);
	} finally {
		play.remove();
	}
	await expect.poll(() => previewAudioContext().state).toBe('running');
}

beforeEach(() => {
	timelineStore.setAll({ tracks: createDefaultTracks(), items: [clip] });
});

afterEach(() => {
	editorSession.stopPlayback();
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	disposeNoiseReductionPreviewWorker();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

it.each(['direct', 'nested', 'nested with effect', 'nested wrapper', 'disabled wrapper'] as const)(
	'honors noise-reduction settings in the samples played by %s audio',
	async (mode) => {
		const messages = captureWorkletMessages();
		const url = URL.createObjectURL(noisyTone());
		const patch: Partial<TimelineItem> = {
			audioNoiseReductionEnabled: true,
			audioNoiseReductionAmount: 100
		};
		if (mode === 'nested with effect' || mode === 'disabled wrapper')
			patch.audioEffects = [{ id: 'pan', type: 'pan', enabled: true, pan: 1 }];
		const screen =
			mode === 'direct'
				? await render(PreviewAudioLayer, { item: { ...clip, ...patch }, url })
				: await render(PreviewMixEntryLayer, {
						entry:
							mode === 'nested wrapper'
								? nestedEntry({}, patch)
								: mode === 'disabled wrapper'
									? nestedEntry(patch, { audioNoiseReductionEnabled: false })
									: nestedEntry(patch),
						url
					});
		try {
			await expect
				.poll(() => messages.some((message) => message.type === 'append-source'), { timeout: 5000 })
				.toBe(true);
			const filtered = new Float32Array(
				messages.find((message) => message.type === 'append-source')!.leftChannel!
			);
			// Compare delivered samples with independently decoded source audio. Bypassed
			// noise reduction must not pass merely because a worklet was constructed.
			const context = new OfflineAudioContext(
				1,
				1,
				messages.find((message) => message.type === 'append-source')!.sampleRate!
			);
			const source = await context.decodeAudioData(await (await fetch(url)).arrayBuffer());
			const original = source.getChannelData(0);
			let originalHighEnergy = 0,
				filteredHighEnergy = 0;
			for (let i = 1; i < Math.min(original.length, filtered.length); i++) {
				originalHighEnergy += (original[i]! - original[i - 1]!) ** 2;
				filteredHighEnergy += (filtered[i]! - filtered[i - 1]!) ** 2;
			}
			if (mode === 'disabled wrapper')
				expect(filteredHighEnergy).toBeGreaterThan(originalHighEnergy * 0.99);
			else expect(filteredHighEnergy).toBeLessThan(originalHighEnergy * 0.9);
			expect(filtered.some((sample) => Math.abs(sample) > 0.001)).toBe(true);
		} finally {
			await screen.unmount();
			URL.revokeObjectURL(url);
		}
	}
);

it.each([false, true])(
	'seeks nested speed ramps to the authored source time (with effect: %s)',
	async (withEffect) => {
		const messages = captureWorkletMessages();
		const patch: Partial<TimelineItem> = {
			sourceStart: 0,
			sourceEnd: 270,
			sourceFps: 30,
			durationInFrames: 150,
			speedRamp: [
				{ id: 'normal', sourceFrame: 0, speed: 1, easing: 'hold' },
				{ id: 'fast', sourceFrame: 30, speed: 2, easing: 'hold' },
				{ id: 'end', sourceFrame: 270, speed: 2, easing: 'hold' }
			]
		};
		if (withEffect) patch.audioEffects = [{ id: 'pan', type: 'pan', enabled: true, pan: 1 }];
		editorSession.clock.seek(60);
		const screen = await render(PreviewMixEntryLayer, {
			entry: nestedEntry(patch),
			url: fixtureUrl
		});
		try {
			await expect
				.poll(() => messages.some((message) => message.type === 'append-source'))
				.toBe(true);
			const sampleRate = messages.find((message) => message.type === 'append-source')!.sampleRate!;
			// Nested mix curves resolve at the composition frame rate.
			await expect
				.poll(() =>
					Math.abs(
						(messages.findLast((message) => message.type === 'seek')?.frame ??
							Number.POSITIVE_INFINITY) /
							sampleRate -
							3
					)
				)
				.toBeLessThan(1 / 30);
			await expect
				.poll(() => messages.findLast((message) => message.type === 'set-tempo')?.tempo)
				.toBe(2);
		} finally {
			await screen.unmount();
		}
	}
);

it.each(['direct', 'nested'] as const)(
	'updates processed %s audio when shuttle speed changes',
	async (mode) => {
		const messages = captureWorkletMessages();
		const patch: Partial<TimelineItem> = {
			audioEffects: [{ id: 'pan', type: 'pan', enabled: true, pan: 1 }]
		};
		const screen =
			mode === 'direct'
				? await render(PreviewAudioLayer, { item: { ...clip, ...patch }, url: fixtureUrl })
				: await render(PreviewMixEntryLayer, { entry: nestedEntry(patch), url: fixtureUrl });
		try {
			await expect
				.poll(() => messages.some((message) => message.type === 'append-source'))
				.toBe(true);
			editorSession.clock.setRate(2);
			await expect
				.poll(() => messages.findLast((message) => message.type === 'set-tempo')?.tempo)
				.toBe(2);
		} finally {
			await screen.unmount();
		}
	}
);

it.each(['direct', 'nested'] as const)(
	'keeps processed %s audio continuous during 2x shuttle playback',
	async (mode) => {
		const messages = captureWorkletMessages();
		const patch: Partial<TimelineItem> = {
			audioEffects: [{ id: 'pan', type: 'pan', enabled: true, pan: 1 }]
		};
		const screen =
			mode === 'direct'
				? await render(PreviewAudioLayer, { item: { ...clip, ...patch }, url: fixtureUrl })
				: await render(PreviewMixEntryLayer, { entry: nestedEntry(patch), url: fixtureUrl });
		try {
			await expect
				.poll(() => messages.some((message) => message.type === 'append-source'))
				.toBe(true);
			await startAudiblePlayback();
			editorSession.clock.setRate(2);
			await expect.poll(() => timelineStore.currentFrame).toBeGreaterThan(30);
			messages.length = 0;
			const start = timelineStore.currentFrame;
			await expect.poll(() => timelineStore.currentFrame).toBeGreaterThan(start + 60);
			// Continuous playback may correct startup drift, but must not repeatedly reset
			// the processor's source cursor solely because the transport runs faster.
			expect(messages.filter((message) => message.type === 'seek').length).toBeLessThanOrEqual(2);
			await expect.poll(() => readMixerMasterLevels().peakRight).toBeGreaterThan(0.001);
		} finally {
			await screen.unmount();
		}
	}
);

it.each(['direct', 'nested'] as const)(
	'updates %s processed direction when reversing at the source midpoint',
	async (mode) => {
		const messages = captureWorkletMessages();
		const patch: Partial<TimelineItem> = {
			audioEffects: [{ id: 'pan', type: 'pan', enabled: true, pan: 1 }]
		};
		timelineStore.setAll({ items: [{ ...clip, ...patch }] });
		const screen =
			mode === 'direct'
				? await render(PreviewAudioLayer, {
						item: timelineStore.itemById.get(clip.id)!,
						url: fixtureUrl
					})
				: await render(PreviewMixEntryLayer, { entry: nestedEntry(patch), url: fixtureUrl });
		try {
			await expect
				.poll(() => messages.some((message) => message.type === 'append-source'))
				.toBe(true);
			await startAudiblePlayback();
			editorSession.clock.setRate(0.1);
			editorSession.clock.seek(150);
			if (mode === 'direct') {
				updateItemProperties(clip.id, { isReversed: true });
				await tick();
			} else await screen.rerender({ entry: nestedEntry({ ...patch, isReversed: true }) });
			expect(messages.findLast((message) => message.type === 'seek')?.direction).toBe(-1);
		} finally {
			await screen.unmount();
		}
	}
);

it.each(['direct', 'nested'] as const)(
	'keeps noise reduction during reverse shuttle in %s audio',
	async (mode) => {
		const url = URL.createObjectURL(noisyTone());
		const grains: Float32Array[] = [];
		const context = previewAudioContext();
		const create = context.createBufferSource.bind(context);
		vi.spyOn(context, 'createBufferSource').mockImplementation(() => {
			const source = create();
			const start = source.start.bind(source);
			vi.spyOn(source, 'start').mockImplementation((...args) => {
				if (source.buffer) grains.push(new Float32Array(source.buffer.getChannelData(0)));
				start(...args);
			});
			return source;
		});
		const patch: Partial<TimelineItem> = {
			audioNoiseReductionEnabled: true,
			audioNoiseReductionAmount: 100
		};
		const screen =
			mode === 'direct'
				? await render(PreviewAudioLayer, { item: { ...clip, ...patch }, url })
				: await render(PreviewMixEntryLayer, { entry: nestedEntry(patch), url });
		try {
			await startAudiblePlayback();
			editorSession.clock.seek(20);
			editorSession.clock.setRate(-1);
			await expect.poll(() => grains.length).toBeGreaterThan(0);
			let energy = 0,
				highEnergy = 0;
			for (const grain of grains) {
				for (let i = Math.floor(grain.length / 4); i < (grain.length * 3) / 4; i++) {
					energy += grain[i]! ** 2;
					highEnergy += (grain[i]! - grain[i - 1]!) ** 2;
				}
			}
			expect(energy).toBeGreaterThan(1);
			// A 1kHz tone has little adjacent-sample energy. The authored filtering
			// must suppress the added broadband hiss even when grains play backwards.
			expect(highEnergy / energy).toBeLessThan(0.15);
		} finally {
			await screen.unmount();
			URL.revokeObjectURL(url);
		}
	}
);
