import { afterEach, describe, expect, it } from 'vitest';
import {
	BufferTarget,
	Mp4OutputFormat,
	Output,
	VideoSample,
	VideoSampleSink,
	VideoSampleSource,
	Input,
	BlobSource,
	ALL_FORMATS
} from 'mediabunny';
import { renderMultiTrackVideoArtifact, TimelineFrameRenderer } from './render-export';
import { mediaPool } from './pool.svelte';
import type { Project, TimelineItem, TimelineTrack } from '../project/types';

// Opt-in export benchmark: OPENPOST_VIDEO_BENCH=1 bunx vitest run --project client <this file>
const enabled = import.meta.env.VITE_OPENPOST_VIDEO_BENCH === '1';
const FPS = 30;
const W = 1920;
const H = 1080;
const SOURCE_FRAMES = 300;

async function source1080(): Promise<Blob> {
	const target = new BufferTarget();
	const output = new Output({ format: new Mp4OutputFormat(), target });
	const src = new VideoSampleSource({ codec: 'avc', bitrate: 8_000_000, keyFrameInterval: 2 });
	output.addVideoTrack(src, { frameRate: FPS });
	await output.start();
	const canvas = new OffscreenCanvas(W, H);
	const ctx = canvas.getContext('2d')!;
	for (let f = 0; f < SOURCE_FRAMES; f++) {
		const g = ctx.createLinearGradient(0, 0, W, H);
		g.addColorStop(0, `hsl(${(f * 3) % 360} 70% 50%)`);
		g.addColorStop(1, `hsl(${(f * 3 + 120) % 360} 70% 30%)`);
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, W, H);
		ctx.fillStyle = 'white';
		ctx.fillRect((f * 13) % (W - 200), 400, 200, 200);
		const s = new VideoSample(canvas, { timestamp: f / FPS, duration: 1 / FPS });
		await src.add(s);
		s.close();
	}
	src.close();
	await output.finalize();
	return new Blob([target.buffer!], { type: 'video/mp4' });
}

const track = (id: string, order: number): TimelineTrack => ({
	id,
	name: id,
	order,
	kind: 'video',
	height: 80,
	visible: true,
	locked: false,
	muted: false,
	solo: false
});

const clip = (id: string, trackId: string, extra: Partial<TimelineItem> = {}): TimelineItem =>
	({
		id,
		type: 'video',
		trackId,
		mediaId: 'source',
		from: 0,
		durationInFrames: SOURCE_FRAMES,
		label: id,
		sourceFps: FPS,
		sourceWidth: W,
		sourceHeight: H,
		...extra
	}) as TimelineItem;

function project(
	tracks: TimelineTrack[],
	items: TimelineItem[],
	duration = SOURCE_FRAMES
): Project {
	return {
		id: 'bench',
		name: 'Bench',
		description: '',
		createdAt: 0,
		updatedAt: 0,
		duration: duration / FPS,
		metadata: { width: W, height: H, fps: FPS },
		timeline: { tracks, items }
	};
}

async function backendInfo() {
	const gl = new OffscreenCanvas(8, 8).getContext('webgl2');
	const ext = gl?.getExtension('WEBGL_debug_renderer_info');
	const renderer = gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'no webgl2';
	const support = await VideoEncoder.isConfigSupported({
		codec: 'avc1.640028',
		width: W,
		height: H,
		bitrate: 8_000_000,
		hardwareAcceleration: 'prefer-hardware'
	});
	const soft = await VideoEncoder.isConfigSupported({
		codec: 'avc1.640028',
		width: W,
		height: H,
		bitrate: 8_000_000,
		hardwareAcceleration: 'prefer-software'
	});
	return `webgl="${renderer}" hwEncodeSupported=${support.supported} swEncodeSupported=${soft.supported}`;
}

type Timing = { render: number; add: number };
function instrument(): { timing: Timing; restore: () => void } {
	const timing: Timing = { render: 0, add: 0 };
	const render = TimelineFrameRenderer.prototype.render;
	const add = VideoSampleSource.prototype.add;
	TimelineFrameRenderer.prototype.render = async function (
		this: TimelineFrameRenderer,
		...a: [number]
	) {
		const t = performance.now();
		try {
			return await render.apply(this, a);
		} finally {
			timing.render += performance.now() - t;
		}
	};
	VideoSampleSource.prototype.add = async function (this: VideoSampleSource, ...a: [VideoSample]) {
		const t = performance.now();
		try {
			return await add.apply(this, a);
		} finally {
			timing.add += performance.now() - t;
		}
	};
	return {
		timing,
		restore: () => {
			TimelineFrameRenderer.prototype.render = render;
			VideoSampleSource.prototype.add = add;
		}
	};
}

async function run(
	name: string,
	p: Project,
	frames: number,
	options: { format: 'mp4' | 'webm'; codec: 'avc' | 'vp9' } = { format: 'mp4', codec: 'avc' }
) {
	const inst = instrument();
	const t0 = performance.now();
	const artifact = await renderMultiTrackVideoArtifact(p, options);
	const total = performance.now() - t0;
	inst.restore();
	const line =
		`[bench] ${name}: method=${artifact.renderMethod} frames=${frames} total=${total.toFixed(0)}ms ` +
		`fps=${((frames / total) * 1000).toFixed(1)} ms/frame=${(total / frames).toFixed(1)} ` +
		`render(decode+composite)=${(inst.timing.render / frames).toFixed(1)} ` +
		`encodeAddWait=${(inst.timing.add / frames).toFixed(1)} out=${(artifact.blob.size / 1e6).toFixed(1)}MB`;
	console.log(line);
	return artifact;
}

afterEach(() => mediaPool.clear());

describe.skipIf(!enabled)('export benchmark (1080p30, 10 s source)', () => {
	it('measures export scenarios', { timeout: 540_000 }, async () => {
		console.log(`[bench] backend ${await backendInfo()}`);
		const blob = await source1080();
		const url = URL.createObjectURL(blob);
		mediaPool.upsert(
			{
				id: 'source',
				storageType: 'cloud',
				remoteUrl: url,
				fileName: 'source.mp4',
				fileSize: blob.size,
				mimeType: blob.type,
				duration: SOURCE_FRAMES / FPS,
				width: W,
				height: H,
				fps: FPS,
				codec: 'avc',
				bitrate: 8_000_000,
				tags: []
			},
			'ready'
		);
		// Pure decode ceiling for the source.
		{
			const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
			const sink = new VideoSampleSink((await input.getPrimaryVideoTrack())!);
			const t = performance.now();
			let n = 0;
			for await (const s of sink.samples()) {
				n++;
				s.close();
			}
			const ms = performance.now() - t;
			console.log(`[bench] decode-only: ${n} frames ${((n / ms) * 1000).toFixed(1)} fps`);
		}
		// (a) single clip re-encode. A tiny transform change keeps it off the remux path.
		await run(
			'a single-clip re-encode',
			project(
				[track('v', 0)],
				[clip('c', 'v', { transform: { scaleX: 0.9, scaleY: 0.9 } } as never)]
			),
			SOURCE_FRAMES
		);
		// (a2) the same edit through the WebM/VP9 path.
		await run(
			'a2 single-clip re-encode webm/vp9',
			project(
				[track('v', 0)],
				[clip('c', 'v', { transform: { scaleX: 0.9, scaleY: 0.9 } } as never)]
			),
			SOURCE_FRAMES,
			{ format: 'webm', codec: 'vp9' }
		);
		// (b) two tracks, blend + opacity, plus text.
		await run(
			'b two-track blend + text',
			project(
				[track('v1', 0), track('v2', 1), track('t', 2)],
				[
					clip('base', 'v1'),
					clip('over', 'v2', {
						blendMode: 'multiply',
						transform: { opacity: 0.6, scaleX: 0.8, scaleY: 0.8 }
					} as never),
					{
						id: 'title',
						type: 'text',
						trackId: 't',
						from: 0,
						durationInFrames: SOURCE_FRAMES,
						label: 'Title',
						fontFamily: 'sans-serif',
						fontSize: 96,
						color: '#ffffff',
						text: 'Benchmark'
					} as TimelineItem
				]
			),
			SOURCE_FRAMES
		);
		// (c) cut-only: should be smart copy.
		await run(
			'c cut-only',
			project([track('v', 0)], [clip('cut', 'v', { sourceStart: 0, durationInFrames: 150 })], 150),
			150
		);
		URL.revokeObjectURL(url);
		expect(true).toBe(true);
	});
});
