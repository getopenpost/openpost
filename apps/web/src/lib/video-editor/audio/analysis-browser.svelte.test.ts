import { render } from 'vitest-browser-svelte';
import CleanupStreamFixture from '../../quick-cut/components/cleanup-stream.fixture.svelte';
import { createSegment } from '../../quick-cut/model';
import { removeSourceRanges } from '../../quick-cut/range-edit';
import {
	createNewProject,
	saveProjectToWorkspace,
	loadProjectFromWorkspace
} from '../../quick-cut/project';
import { exportSegments, discardScratchFile } from '../../quick-cut/export';
import { getWorkspaceRoot, setWorkspaceRoot } from '../workspace-fs/root';
import { probeSourceFile } from '../../quick-cut/source';
import '../../../routes/layout.css';
import { describe, expect, it, vi } from 'vitest';
import { createFloat32WavBlob } from '../local-ai/audio';
import { decodeAudioBlobRangeForAnalysis } from './analysis-decoder';
import { analyzeAudioBlob } from './analysis-client';
import { detectSilentRanges } from './audio-silence';

describe('source audio cleanup', () => {
	it('retains audible opposite-phase stereo through decode and silence detection', async () => {
		const sampleRate = 16000;
		const left = Float32Array.from({ length: sampleRate * 3 }, (_, index) =>
			index < sampleRate || index >= sampleRate * 2
				? 0
				: 0.5 * Math.sin((2 * Math.PI * 440 * index) / sampleRate)
		);
		const right = left.map((sample) => -sample);
		const audio = await decodeAudioBlobRangeForAnalysis(
			createFloat32WavBlob([left, right], sampleRate)
		);
		const ranges = detectSilentRanges(audio, { minSilenceMs: 300, paddingMs: 0 });
		expect(ranges).toEqual([
			{ start: 0, end: 1 },
			{ start: 2, end: 3 }
		]);
	});
	it('runs signal analysis in the production worker and cancels outstanding work', async () => {
		const audio = createFloat32WavBlob([new Float32Array(48000)], 16000);
		expect(await analyzeAudioBlob(audio, { mode: 'signal', paddingMs: 0 })).toEqual([
			{ start: 0, end: 3 }
		]);
		const controller = new AbortController();
		const job = analyzeAudioBlob(audio, {
			mode: 'speech',
			audioTrackIndices: [0],
			signal: controller.signal
		});
		controller.abort();
		await expect(job).rejects.toMatchObject({ name: 'AbortError' });
	});
	it('preserves audible ranges across decode chunks and all selected audio tracks', async () => {
		const sampleRate = 16000;
		const samples = Float32Array.from({ length: sampleRate * 19 }, (_, i) =>
			i >= sampleRate * 15.8 && i < sampleRate * 16.5
				? Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.5
				: 0
		);
		const ranges = await analyzeAudioBlob(createFloat32WavBlob([samples], sampleRate), {
			mode: 'signal',
			paddingMs: 0
		});
		expect(ranges).toEqual([
			{ start: 0, end: 15.8 },
			{ start: 16.5, end: 19 }
		]);
		const blob = await audioTracks([
			new Float32Array(48000),
			Float32Array.from(
				{ length: 48000 },
				(_, i) => Math.sin((2 * Math.PI * 440 * i) / 48000) * 0.5
			)
		]);
		expect(
			await analyzeAudioBlob(blob, { mode: 'signal', audioTrackIndices: [0], paddingMs: 0 })
		).toHaveLength(1);
		expect(
			await analyzeAudioBlob(blob, { mode: 'signal', audioTrackIndices: [0, 1], paddingMs: 0 })
		).toEqual([]);
	});

	it('reviews silence on the explicitly selected reactive Quick Cut stream', async () => {
		const rate = 48000;
		const blob = await audioTracks([
			Float32Array.from(
				{ length: rate * 4 },
				(_, i) => Math.sin((2 * Math.PI * 440 * i) / rate) * 0.4
			),
			Float32Array.from({ length: rate * 4 }, (_, i) =>
				i >= rate && i < rate * 3 ? 0 : Math.sin((2 * Math.PI * 880 * i) / rate) * 0.4
			)
		]);
		const source = await probeSourceFile(
			new File([blob], 'selected-stream.webm', { type: 'audio/webm' })
		);
		const onchange = vi.fn();
		const onapply = vi.fn();
		const screen = await render(CleanupStreamFixture, { initial: source, onchange, onapply });
		await screen
			.getByRole('checkbox', { name: 'Audio 2 selected-stream.webm', exact: true })
			.click();
		await screen
			.getByRole('checkbox', { name: 'Audio 1 selected-stream.webm', exact: true })
			.click();
		expect(onchange.mock.lastCall?.[0].selectedAudioTrackIndices).toEqual([1]);
		await screen.getByRole('button', { name: 'Find cuts', exact: true }).click();
		await expect
			.poll(
				() =>
					Boolean(document.querySelector('[role=alert]')) ||
					[...document.querySelectorAll('button')].some(
						(button) => button.textContent?.trim() === 'Apply selected cuts'
					)
			)
			.toBe(true);
		expect(document.querySelector('[role=alert]')?.textContent).toBeUndefined();
		await expect
			.element(screen.getByRole('button', { name: 'Apply selected cuts', exact: true }))
			.toBeEnabled();
		await screen.getByRole('button', { name: 'Apply selected cuts', exact: true }).click();
		const ranges = onapply.mock.lastCall?.[1];
		expect(ranges).toHaveLength(1);
		// Opus has a decay tail. The proposed cut must stay inside the authored quiet gap,
		// include its center and remove most of its two seconds without cutting either tone.
		expect(ranges[0].start).toBeGreaterThanOrEqual(1);
		expect(ranges[0].end).toBeLessThanOrEqual(3);
		expect(ranges[0].start).toBeLessThan(2);
		expect(ranges[0].end).toBeGreaterThan(2);
		expect(ranges[0].end - ranges[0].start).toBeGreaterThan(1.5);
		const selectedSource = { ...source, ...onchange.mock.lastCall![0] };
		const kept = removeSourceRanges(
			[createSegment(0, 4, { sourceId: source.id })],
			source.id,
			ranges
		);
		expect(kept).toHaveLength(2);
		expect(kept[0]!.start).toBe(0);
		expect(kept[1]!.end).toBe(4);
		const artifacts = await exportSegments({
			sources: [selectedSource],
			segments: kept,
			cutMode: 'exact',
			merge: true
		});
		try {
			expect(artifacts).toHaveLength(1);
			const audio = await decodeAudioBlobRangeForAnalysis(artifacts[0]!.scratchFile);
			expect(audio.numberOfChannels).toBe(1);
			expect(audio.duration).toBeCloseTo(4 - (ranges[0].end - ranges[0].start), 1);
			const samples = audio.getChannelData(0);
			const energy = (frequency: number) => {
				let real = 0,
					imaginary = 0;
				for (let i = 0; i < audio.sampleRate / 2; i++) {
					const angle = (2 * Math.PI * frequency * i) / audio.sampleRate;
					real += samples[i]! * Math.cos(angle);
					imaginary += samples[i]! * Math.sin(angle);
				}
				return real * real + imaginary * imaginary;
			};
			expect(energy(880)).toBeGreaterThan(energy(440) * 100);
		} finally {
			await Promise.all(artifacts.map((artifact) => discardScratchFile(artifact.scratchPath)));
		}
		const previous = getWorkspaceRoot();
		const root = await navigator.storage.getDirectory();
		const name = `selected-stream-${crypto.randomUUID()}`;
		setWorkspaceRoot(await root.getDirectoryHandle(name, { create: true }));
		try {
			const project = createNewProject([selectedSource]);
			project.segments = kept;
			await saveProjectToWorkspace(project);
			const restored = (await loadProjectFromWorkspace(project.id))!;
			expect(restored.sources[0]!.selectedAudioTrackIndices).toEqual([1]);
			await screen.unmount();
			const reopened = await render(CleanupStreamFixture, {
				initial: { ...source, ...restored.sources[0]! },
				onchange: vi.fn(),
				onapply: vi.fn()
			});
			await expect
				.element(
					reopened.getByRole('checkbox', { name: 'Audio 1 selected-stream.webm', exact: true })
				)
				.not.toBeChecked();
			await expect
				.element(
					reopened.getByRole('checkbox', { name: 'Audio 2 selected-stream.webm', exact: true })
				)
				.toBeChecked();
			await reopened
				.getByRole('checkbox', { name: 'Audio 1 selected-stream.webm', exact: true })
				.click();
			await reopened.getByRole('button', { name: 'Find cuts', exact: true }).click();
			await expect.element(reopened.getByRole('status')).toHaveTextContent('0 cuts selected');
			await expect
				.element(reopened.getByRole('button', { name: 'Apply selected cuts', exact: true }))
				.toBeDisabled();
		} finally {
			setWorkspaceRoot(previous);
			await root.removeEntry(name, { recursive: true });
		}
	}, 60000);

	it('keeps short gaps between speakers on different audio tracks', async () => {
		const rate = 48000;
		const tone = (i: number) => Math.sin((2 * Math.PI * 440 * i) / rate) * 0.5;
		const blob = await audioTracks([
			Float32Array.from({ length: rate * 2 }, (_, i) => (i < rate ? 0 : tone(i))),
			Float32Array.from({ length: rate * 2 }, (_, i) => (i < rate * 0.9 ? tone(i) : 0))
		]);
		expect(
			await analyzeAudioBlob(blob, {
				mode: 'signal',
				audioTrackIndices: [0, 1],
				minSilenceMs: 500,
				paddingMs: 0
			})
		).toEqual([]);
	});
});

async function audioTracks(channels: Float32Array[]): Promise<Blob> {
	const { Output, BufferTarget, WebMOutputFormat, AudioSampleSource, AudioSample } =
		await import('mediabunny');
	const target = new BufferTarget();
	const output = new Output({ target, format: new WebMOutputFormat() });
	const tracks = channels.map(() => new AudioSampleSource({ codec: 'opus', bitrate: 64000 }));
	for (const track of tracks) output.addAudioTrack(track);
	await output.start();
	for (let index = 0; index < tracks.length; index += 1) {
		const sample = new AudioSample({
			data: channels[index]!,
			format: 'f32',
			sampleRate: 48000,
			numberOfChannels: 1,
			timestamp: 0
		});
		await tracks[index]!.add(sample);
		sample.close();
		tracks[index]!.close();
	}
	await output.finalize();
	return new Blob([target.buffer!], { type: 'audio/webm' });
}
