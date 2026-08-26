/**
 * Playback clock — single source of truth for timeline playback time.
 *
 * rAF loop; frame = (rate >= 0 ? floor : ceil)(startFrame + elapsed·fps·rate).
 * Prefers a running AudioContext.currentTime over performance.now() as the
 * hardware time source (eliminates A/V drift by construction), mapping epochs
 * on source switch. Supports half-open range playback [start, end), looping,
 * signed rates with re-anchor, visibility catch-up, throttled timeupdate.
 * currentFrame never exposes values outside [start, end - 1] while a range is
 * active. Forward end lands on end - 1, reverse end lands on start.
 *
 * Time sources are injectable for tests.
 *
 * Ported from FreeCut (MIT) — runtime/player/clock/Clock.ts, trimmed to v1.
 */

export type ClockEventType =
	| 'framechange'
	| 'play'
	| 'pause'
	| 'seek'
	| 'ratechange'
	| 'ended'
	| 'timeupdate';

type Listener = (frame: number) => void;

export interface ClockTimeSource {
	/** Seconds on a monotonic clock. */
	now(): number;
}

class PerformanceTimeSource implements ClockTimeSource {
	now(): number {
		return performance.now() / 1000;
	}
}

export class AudioContextTimeSource implements ClockTimeSource {
	constructor(private readonly context: AudioContext) {}
	now(): number {
		return this.context.currentTime;
	}
}

export interface ClockOptions {
	fps: number;
	timeSource?: ClockTimeSource;
	/** Return false to reject external playhead seeks while a linear capture is active. */
	canSeek?: () => boolean;
	/** Throttle window for timeupdate events, seconds. */
	timeUpdateInterval?: number;
}

export class Clock {
	private frame: number;
	private rate = 1;
	private playing = false;
	private loopRange: { start: number; end: number } | null = null;
	private range: { start: number; end: number } | null = null;
	private resumeRange: { start: number; end: number } | null = null;
	private resumeLoop = false;

	private anchorWallSeconds = 0;
	private anchorFrame = 0;
	private lastEmittedFrame: number | null = null;
	private lastTimeUpdateSeconds = 0;

	private rafId: number | null = null;
	private listeners = new Map<ClockEventType, Set<Listener>>();
	private fps: number;
	private readonly timeSource: ClockTimeSource;
	private readonly timeUpdateInterval: number;
	private readonly canSeek: () => boolean;
	private onVisibility = (): void => this.catchUp();

	constructor(options: ClockOptions) {
		this.fps = options.fps > 0 ? options.fps : 30;
		this.timeSource = options.timeSource ?? new PerformanceTimeSource();
		this.timeUpdateInterval = options.timeUpdateInterval ?? 0.1;
		this.canSeek = options.canSeek ?? (() => true);
		this.frame = 0;
		if (typeof document !== 'undefined') {
			document.addEventListener('visibilitychange', this.onVisibility);
		}
	}

	dispose(): void {
		this.pause();
		this.listeners.clear();
		if (typeof document !== 'undefined') {
			document.removeEventListener('visibilitychange', this.onVisibility);
		}
	}

	on(event: ClockEventType, listener: Listener): () => void {
		const set = this.listeners.get(event) ?? new Set<Listener>();
		set.add(listener);
		this.listeners.set(event, set);
		return () => set.delete(listener);
	}

	private emit(event: ClockEventType, frame: number): void {
		for (const listener of this.listeners.get(event) ?? []) {
			try {
				listener(frame);
			} catch (error) {
				console.error('[video-editor:Clock] listener threw', error);
			}
		}
	}

	get currentFrame(): number {
		if (!this.playing) return this.frame;
		const computed = this.computeFrame();
		if (this.range) {
			if (this.rate >= 0) return Math.min(computed, this.range.end - 1);
			return Math.max(computed, this.range.start);
		}
		return computed;
	}

	get isPlaying(): boolean {
		return this.playing;
	}

	get playbackRate(): number {
		return this.rate;
	}

	private computeFrame(): number {
		const elapsed = Math.max(0, this.timeSource.now() - this.anchorWallSeconds);
		let value = this.anchorFrame + elapsed * this.fps * this.rate;
		if (this.playing) {
			value = this.rate >= 0 ? Math.floor(value) : Math.ceil(value);
		}
		return value;
	}

	private anchorAt(frame: number): void {
		this.anchorFrame = frame;
		this.anchorWallSeconds = this.timeSource.now();
	}

	private catchUp(): void {
		if (!this.playing) return;
		const computed = this.computeFrame();
		this.anchorAt(computed);
	}

	seek(frame: number): void {
		if (!this.canSeek()) return;
		const next = Math.max(0, Math.round(frame));
		const wasPlaying = this.playing;
		if (wasPlaying) this.pause();
		this.frame = next;
		this.lastEmittedFrame = null;
		this.emit('seek', next);
		this.emit('framechange', next);
		if (wasPlaying) this.play();
	}

	private get actualFirstFrame(): number {
		return this.range ? this.range.start : 0;
	}

	private get actualLastFrame(): number {
		return this.range ? this.range.end - 1 : Number.POSITIVE_INFINITY;
	}

	play(options?: { range?: { start: number; end: number }; loop?: boolean }): void {
		if (this.playing) return;
		if (options) {
			this.range = options.range ?? null;
			this.loopRange = options.loop ? (options.range ?? null) : null;
			this.resumeRange = this.range;
			this.resumeLoop = Boolean(options.loop);
		} else if (!this.playing) {
			// Resume keeps whatever range/loop was last requested.
			this.range = this.resumeRange;
			this.loopRange = this.resumeLoop ? this.resumeRange : null;
		}
		let start = this.frame;
		if (this.range) {
			const first = this.actualFirstFrame;
			const last = this.actualLastFrame;
			if (this.rate >= 0) {
				if (start < first) start = first;
				if (start >= last + 1) start = first;
				if (this.loopRange && start >= this.loopRange.end - 1) start = this.loopRange.start;
			} else {
				if (start >= this.range.end) start = last;
				if (start <= first) start = last;
			}
		}
		this.anchorAt(start);
		this.playing = true;
		this.emit('play', start);
		this.tick();
	}

	pause(): void {
		if (!this.playing) return;
		this.frame = this.computeFrame();
		this.playing = false;
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
		this.emit('pause', this.frame);
		this.emit('timeupdate', this.frame);
	}

	setRate(rate: number): void {
		if (!Number.isFinite(rate) || rate === 0 || rate === this.rate) return;
		if (this.playing) {
			this.frame = this.computeFrame();
			this.anchorAt(this.frame);
		}
		this.rate = rate;
		this.emit('ratechange', this.currentFrame);
	}

	setFps(fps: number): void {
		if (!Number.isFinite(fps) || fps <= 0 || fps === this.fps) return;
		// Re-anchor so wall-time mapping follows the new fps instead of jumping.
		const current = this.currentFrame;
		this.fps = fps;
		if (this.playing) this.anchorAt(current);
		else this.frame = current;
	}

	private tick = (): void => {
		if (!this.playing) return;
		const frame = this.computeFrame();

		if (this.range) {
			if (this.rate >= 0 && frame >= this.range.end) {
				if (this.loopRange) {
					this.seek(this.loopRange.start);
					this.emit('timeupdate', this.loopRange.start);
					this.rafId = requestAnimationFrame(this.tick);
					return;
				}
				this.frame = this.range.end - 1;
				this.playing = false;
				if (this.rafId !== null) {
					cancelAnimationFrame(this.rafId);
					this.rafId = null;
				}
				this.emit('pause', this.frame);
				this.emit('timeupdate', this.frame);
				this.emit('ended', this.range.end);
				return;
			}
			if (this.rate < 0 && frame < this.range.start) {
				if (this.loopRange) {
					const target = this.loopRange.end - 1;
					this.seek(target);
					this.emit('timeupdate', target);
					this.rafId = requestAnimationFrame(this.tick);
					return;
				}
				this.frame = this.range.start;
				this.playing = false;
				if (this.rafId !== null) {
					cancelAnimationFrame(this.rafId);
					this.rafId = null;
				}
				this.emit('pause', this.frame);
				this.emit('timeupdate', this.frame);
				this.emit('ended', this.range.start);
				return;
			}
		}

		if (frame !== this.lastEmittedFrame) {
			this.emit('framechange', frame);
			this.lastEmittedFrame = frame;
		}
		const nowSeconds = this.timeSource.now();
		if (nowSeconds - this.lastTimeUpdateSeconds >= this.timeUpdateInterval) {
			this.lastTimeUpdateSeconds = nowSeconds;
			this.emit('timeupdate', frame);
		}

		this.rafId = requestAnimationFrame(this.tick);
	};
}
