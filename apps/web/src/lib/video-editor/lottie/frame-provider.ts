/** Deterministic, frame-addressed Lottie rendering for preview and export. */

import { DotLottie } from '@lottiefiles/dotlottie-web';
import wasmUrl from '@lottiefiles/dotlottie-web/dotlottie-player.wasm?url';
import type { LottieRenderSpec } from './render-spec';
import type { LottieSlotValue } from './slots';

let wasmConfigured = false;

export function ensureLottieWasm(): void {
	if (wasmConfigured) return;
	DotLottie.setWasmUrl(wasmUrl);
	wasmConfigured = true;
}

export interface LottieFrameMapInput {
	localFrame: number;
	projectFps: number;
	speed: number;
	totalFrames: number;
	frameRate: number;
	loop: boolean;
	reversed?: boolean;
	loopMode?: 'loop' | 'pingpong';
	segmentStart?: number;
	segmentEnd?: number;
}

/** Map a project frame onto an inclusive Lottie source segment. */
export function mapTimelineFrameToLottieFrame({
	localFrame,
	projectFps,
	speed,
	totalFrames,
	frameRate,
	loop,
	reversed = false,
	loopMode = 'loop',
	segmentStart,
	segmentEnd
}: LottieFrameMapInput): number {
	if (totalFrames <= 0 || projectFps <= 0 || frameRate <= 0) return 0;
	const maxFrame = totalFrames - 1;
	const start = Math.max(0, Math.min(segmentStart ?? 0, maxFrame));
	const end = Math.max(start, Math.min(segmentEnd ?? maxFrame, maxFrame));
	const span = end - start;
	if (span <= 0) return start;

	const elapsed = (localFrame / projectFps) * speed * frameRate;
	let offset: number;
	if (!loop) {
		offset = Math.max(0, Math.min(elapsed, span));
	} else if (loopMode === 'pingpong') {
		const period = span * 2;
		const position = ((elapsed % period) + period) % period;
		offset = position <= span ? position : period - position;
	} else {
		const frameCount = span + 1;
		offset = ((elapsed % frameCount) + frameCount) % frameCount;
	}
	const frame = reversed ? end - offset : start + offset;
	return Math.max(start, Math.min(frame, end));
}

export class LottieRenderer {
	private readonly player: DotLottie;
	private loaded = false;
	private destroyed = false;
	readonly ready: Promise<void>;

	constructor(
		readonly canvas: HTMLCanvasElement | OffscreenCanvas,
		config: {
			src?: string;
			data?: string;
			themeData?: string;
			slots?: Record<string, LottieSlotValue>;
			autoResize?: boolean;
		}
	) {
		ensureLottieWasm();
		const autoResize = config.autoResize ?? false;
		this.player = new DotLottie({
			canvas,
			src: config.src,
			data: config.data,
			autoplay: false,
			loop: false,
			backgroundColor: '#00000000',
			renderConfig: {
				devicePixelRatio: autoResize ? undefined : 1,
				autoResize,
				freezeOnOffscreen: false
			}
		});
		this.ready = new Promise((resolve) => {
			const complete = () => {
				this.loaded = true;
				if (config.themeData) {
					try {
						this.player.setThemeData(config.themeData);
					} catch {
						// Keep the authored theme if the selected theme is malformed.
					}
				}
				this.applySlots(config.slots);
				resolve();
			};
			if (this.player.isLoaded) complete();
			else {
				this.player.addEventListener('load', complete);
				this.player.addEventListener('loadError', () => resolve());
			}
		});
	}

	private applySlots(slots: Record<string, LottieSlotValue> | undefined): void {
		if (!slots) return;
		for (const [id, value] of Object.entries(slots)) {
			try {
				const type = this.player.getSlotType(id);
				if (type === 'scalar' && !Array.isArray(value)) this.player.setScalarSlot(id, value);
				else if (type === 'vector' && Array.isArray(value)) this.player.setVectorSlot(id, value);
			} catch {
				// One invalid slot must not block the other authored controls.
			}
		}
	}

	get isLoaded(): boolean {
		return this.loaded;
	}

	renderFrame(frame: number): void {
		if (!this.loaded || this.destroyed) return;
		this.player.setFrame(frame);
	}

	resize(width: number, height: number): void {
		const nextWidth = Math.max(1, Math.round(width));
		const nextHeight = Math.max(1, Math.round(height));
		if (this.canvas.width === nextWidth && this.canvas.height === nextHeight) return;
		this.canvas.width = nextWidth;
		this.canvas.height = nextHeight;
		this.player.resize();
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.player.destroy();
	}
}

/** Render a poster frame without keeping a player or object URL alive. */
export async function renderLottieThumbnail(
	blob: Blob,
	width: number,
	height: number,
	totalFrames: number
): Promise<Blob | null> {
	const scale = Math.min(1, 512 / Math.max(width, height));
	const canvas = new OffscreenCanvas(
		Math.max(1, Math.round(width * scale)),
		Math.max(1, Math.round(height * scale))
	);
	const url = URL.createObjectURL(blob);
	const renderer = new LottieRenderer(canvas, { src: url });
	try {
		await renderer.ready;
		if (!renderer.isLoaded) return null;
		renderer.renderFrame(Math.floor(Math.max(0, totalFrames - 1) * 0.4));
		return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.86 });
	} catch {
		return null;
	} finally {
		renderer.destroy();
		URL.revokeObjectURL(url);
	}
}

export class LottieFrameProvider {
	private readonly entries = new Map<
		string,
		{ renderer: LottieRenderer; url: string; signature: string }
	>();

	async source(
		key: string,
		blob: Blob,
		width: number,
		height: number,
		frame: number,
		spec?: LottieRenderSpec
	): Promise<OffscreenCanvas | null> {
		const targetWidth = Math.max(1, Math.round(width));
		const targetHeight = Math.max(1, Math.round(height));
		let entry = this.entries.get(key);
		const signature = spec?.signature ?? '';
		if (entry && entry.signature !== signature) {
			entry.renderer.destroy();
			URL.revokeObjectURL(entry.url);
			this.entries.delete(key);
			entry = undefined;
		}
		if (!entry) {
			const url = URL.createObjectURL(blob);
			const canvas = new OffscreenCanvas(targetWidth, targetHeight);
			const renderer = new LottieRenderer(canvas, {
				...(spec?.data ? { data: spec.data } : { src: url }),
				themeData: spec?.themeData ?? undefined,
				slots: spec?.slots ?? undefined
			});
			entry = { renderer, url, signature };
			this.entries.set(key, entry);
			await renderer.ready;
		}
		if (!entry.renderer.isLoaded) return null;
		entry.renderer.resize(targetWidth, targetHeight);
		entry.renderer.renderFrame(frame);
		// SAFETY: this provider always constructs each renderer with an OffscreenCanvas above.
		return entry.renderer.canvas as OffscreenCanvas;
	}

	destroy(): void {
		for (const entry of this.entries.values()) {
			entry.renderer.destroy();
			URL.revokeObjectURL(entry.url);
		}
		this.entries.clear();
	}
}
