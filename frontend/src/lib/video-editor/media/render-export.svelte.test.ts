import { afterEach, describe, expect, it } from 'vitest';
import { BlobSource, CanvasSink, Input, WebMInputFormat } from 'mediabunny';
import type { Project, TimelineItem, TimelineTrack } from '../project/types';
import { mediaPool } from './pool.svelte';
import {
	renderMultiTrackVideoArtifact,
	renderTimelineAudioArtifact,
	TimelineFrameRenderer
} from './render-export';
import { extractMatroskaTextSubtitleTracksFromBlob } from './embedded-subtitles';
import ac3FixtureUrl from './fixtures/tone-ac3.mkv?url';

function linkedFileHandle(file: File): FileSystemFileHandle {
	// SAFETY: resolveMediaBlob only reads name, kind, and getFile from linked handles.
	return {
		kind: 'file',
		name: file.name,
		getFile: async () => file
	} as FileSystemFileHandle;
}

afterEach(() => mediaPool.clear());

describe('render export audio decoding', () => {
	it('mixes a real AC-3 clip into a WAV export', async () => {
		const response = await fetch(ac3FixtureUrl);
		expect(response.ok).toBe(true);
		const file = new File([await response.blob()], 'tone-ac3.mkv', {
			type: 'audio/x-matroska'
		});
		mediaPool.upsert(
			{
				id: 'ac3-source',
				storageType: 'handle',
				fileHandle: linkedFileHandle(file),
				fileName: file.name,
				fileSize: file.size,
				mimeType: file.type,
				duration: 0.3,
				width: 0,
				height: 0,
				fps: 0,
				codec: '',
				audioCodec: 'ac3',
				audioCodecSupported: true,
				bitrate: 96_000,
				tags: ['audio']
			},
			'ready'
		);
		const track: TimelineTrack = {
			id: 'audio',
			name: 'Audio 1',
			kind: 'audio',
			height: 72,
			locked: false,
			visible: true,
			muted: false,
			solo: false,
			volume: 1,
			order: 0
		};
		const item: TimelineItem = {
			id: 'clip',
			trackId: track.id,
			from: 0,
			durationInFrames: 9,
			label: 'AC-3 tone',
			type: 'audio',
			mediaId: 'ac3-source',
			sourceStart: 0,
			sourceEnd: 9,
			sourceFps: 30
		};
		const project: Project = {
			id: 'project',
			name: 'AC3 export',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: 0.3,
			metadata: { width: 1920, height: 1080, fps: 30, backgroundColor: '#000000' },
			timeline: { tracks: [track], items: [item] }
		};

		const artifact = await renderTimelineAudioArtifact(project, { format: 'wav' });
		expect(artifact.fileName).toBe('AC3 export.wav');
		expect(artifact.blob.type).toBe('audio/wav');
		expect(artifact.blob.size).toBeGreaterThan(20_000);

		const context = new AudioContext();
		const unity = await context.decodeAudioData(await artifact.blob.arrayBuffer());
		project.timeline!.masterVolumeDb = -6.020599913279624;
		const attenuatedArtifact = await renderTimelineAudioArtifact(project, { format: 'wav' });
		const attenuated = await context.decodeAudioData(await attenuatedArtifact.blob.arrayBuffer());
		const unityPeak = Math.max(...unity.getChannelData(0).map((sample) => Math.abs(sample)));
		const attenuatedPeak = Math.max(
			...attenuated.getChannelData(0).map((sample) => Math.abs(sample))
		);
		expect(attenuatedPeak / unityPeak).toBeCloseTo(0.5, 2);

		project.timeline!.masterMuted = true;
		const mutedArtifact = await renderTimelineAudioArtifact(project, { format: 'wav' });
		const muted = await context.decodeAudioData(await mutedArtifact.blob.arrayBuffer());
		expect(Math.max(...muted.getChannelData(0).map((sample) => Math.abs(sample)))).toBe(0);
		await context.close();
	});
});

describe('render export exactness', () => {
	it('rejects an export frame instead of omitting an enabled GPU effect', async () => {
		const track: TimelineTrack = {
			id: 'visual',
			name: 'Visual 1',
			kind: 'video',
			height: 72,
			locked: false,
			visible: true,
			muted: false,
			solo: false,
			order: 0
		};
		const item: TimelineItem = {
			id: 'shape',
			trackId: track.id,
			from: 0,
			durationInFrames: 30,
			label: 'Shape',
			type: 'shape',
			shapeType: 'rectangle',
			fillColor: '#ff0000',
			fillEnabled: true,
			transform: { width: 32, height: 32 },
			effects: [
				{
					id: 'missing-renderer',
					type: 'gpu',
					effectId: 'gpu-missing-renderer',
					enabled: true,
					params: {}
				}
			]
		};
		const project: Project = {
			id: 'exactness',
			name: 'Exact export',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: 1,
			metadata: { width: 64, height: 64, fps: 30, backgroundColor: '#000000' },
			timeline: { tracks: [track], items: [item] }
		};
		const renderer = new TimelineFrameRenderer(project);

		try {
			await expect(renderer.render(0)).rejects.toThrowError(
				'Video frame could not render exactly: GPU effect renderer unavailable: gpu-missing-renderer'
			);
		} finally {
			renderer.dispose();
		}
	});

	it('proves burn-in, SRT sidecar, and embedded WebVTT through encoded artifacts', async () => {
		const width = 160;
		const height = 90;
		const fps = 5;
		const track: TimelineTrack = {
			id: 'captions',
			name: 'Captions',
			kind: 'video',
			height: 64,
			locked: false,
			visible: true,
			muted: false,
			solo: false,
			order: 0
		};
		const subtitle: TimelineItem = {
			id: 'caption',
			trackId: track.id,
			from: 0,
			durationInFrames: 2,
			label: 'Caption',
			type: 'subtitle',
			fontFamily: 'Inter',
			fontSize: 28,
			fontWeight: 700,
			color: '#ffffff',
			textAlign: 'center',
			verticalAlign: 'middle',
			transform: { width, height },
			cues: [{ id: 'cue', startFrame: 0, endFrame: 2, text: 'PROOF' }]
		};
		const project: Project = {
			id: 'caption-export',
			name: 'Caption proof',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: 2 / fps,
			metadata: { width, height, fps, backgroundColor: '#000000' },
			timeline: { tracks: [track], items: [subtitle] }
		};
		const render = (subtitleMode: 'burn' | 'sidecar' | 'embedded') =>
			renderMultiTrackVideoArtifact(project, {
				format: 'webm',
				codec: 'vp8',
				quality: 'draft',
				width,
				height,
				subtitleMode
			});

		const burned = await render('burn');
		const sidecar = await render('sidecar');
		expect(sidecar.sidecar?.fileName).toBe('Caption proof.srt');
		expect(await sidecar.sidecar?.blob.text()).toContain('PROOF');

		const brightPixelCount = async (blob: Blob): Promise<number> => {
			const input = new Input({ source: new BlobSource(blob), formats: [new WebMInputFormat()] });
			try {
				const video = await input.getPrimaryVideoTrack();
				if (!video) throw new Error('Encoded caption proof has no video track.');
				const wrapped = await new CanvasSink(video, { width, height, fit: 'fill' }).getCanvas(0);
				if (!wrapped) throw new Error('Encoded caption proof has no first frame.');
				const pixels = wrapped.canvas
					.getContext('2d', { willReadFrequently: true })
					?.getImageData(0, 0, width, height).data;
				if (!pixels) throw new Error('Encoded caption proof has no readable pixels.');
				let bright = 0;
				for (let index = 0; index < pixels.length; index += 4) {
					if ((pixels[index] ?? 0) + (pixels[index + 1] ?? 0) + (pixels[index + 2] ?? 0) > 500)
						bright += 1;
				}
				return bright;
			} finally {
				input.dispose();
			}
		};
		const burnedBrightPixels = await brightPixelCount(burned.blob);
		const sidecarBrightPixels = await brightPixelCount(sidecar.blob);
		expect(burnedBrightPixels).toBeGreaterThan(100);
		expect(sidecarBrightPixels).toBeLessThan(burnedBrightPixels / 10);

		const embedded = await render('embedded');
		const tracks = await extractMatroskaTextSubtitleTracksFromBlob(embedded.blob);
		expect(tracks).toHaveLength(1);
		expect(tracks[0]).toMatchObject({
			codecId: 'S_TEXT/WEBVTT',
			cues: [{ startSeconds: 0, text: 'PROOF' }]
		});
	}, 30_000);
});
