/**
 * Ported from FreeCut (MIT) — preview/utils/player-seek-guard.ts and
 * preview-stage.tsx's rVFC-gated presentation handling.
 *
 * Coalesces <video>.currentTime writes so scrub bursts collapse into one seek
 * per interval window (with a trailing flush for the final target), and
 * detects requestVideoFrameCallback support so playback drift can be corrected
 * against actually-presented frames instead of every animation frame.
 */

export const SEEK_MIN_INTERVAL_MS = 32;

/** Handle for a scheduled trailing flush; cancel() unschedules it. */
export interface ScheduledFlush {
	cancel(): void;
}

/** Whether the video's current time is far enough from the target to seek. */
export function seekDriftExceeded(
	currentTime: number,
	targetTime: number,
	toleranceSeconds: number
): boolean {
	return Math.abs(currentTime - targetTime) > toleranceSeconds;
}

export function supportsVideoFrameCallback(video: {
	requestVideoFrameCallback?: HTMLVideoElement['requestVideoFrameCallback'];
}): boolean {
	return typeof video.requestVideoFrameCallback === 'function';
}

interface SeekSchedulerOptions {
	minIntervalMs?: number;
	now?: () => number;
	schedule?: (fn: () => void, delayMs: number) => ScheduledFlush;
}

export class SeekScheduler {
	private pendingTarget: number | null = null;
	private lastAppliedAt = Number.NEGATIVE_INFINITY;
	private timerHandle: ScheduledFlush | null = null;
	private detached = false;

	private readonly minIntervalMs: number;
	private readonly now: () => number;
	private readonly schedule: (fn: () => void, delayMs: number) => ScheduledFlush;

	constructor(
		private apply: (target: number) => void,
		options?: SeekSchedulerOptions
	) {
		this.minIntervalMs = options?.minIntervalMs ?? SEEK_MIN_INTERVAL_MS;
		this.now = options?.now ?? (() => Date.now());
		this.schedule =
			options?.schedule ??
			((fn, delayMs) => {
				const id = setTimeout(fn, delayMs);
				return {
					cancel: () => {
						clearTimeout(id);
					}
				};
			});
	}

	/** Request a seek to `target`; coalesced when inside the interval window. */
	request(target: number): void {
		if (this.detached) return;
		const elapsed = this.now() - this.lastAppliedAt;
		if (elapsed >= this.minIntervalMs) {
			this.applyNow(target);
			return;
		}

		this.pendingTarget = target;
		if (this.timerHandle === null) {
			this.timerHandle = this.schedule(() => this.flush(), this.minIntervalMs - elapsed);
		}
	}

	/** Apply immediately regardless of the window; drops any pending target. */
	requestImmediate(target: number): void {
		if (this.detached) return;
		this.clearTimer();
		this.pendingTarget = null;
		this.applyNow(target);
	}

	/** Apply the latest coalesced target now, if one is pending. */
	flush(): void {
		this.clearTimer();
		if (this.pendingTarget === null || this.detached) return;
		const target = this.pendingTarget;
		this.pendingTarget = null;
		this.applyNow(target);
	}

	/** Cancel pending work; further requests are ignored. */
	detach(): void {
		this.detached = true;
		this.clearTimer();
		this.pendingTarget = null;
	}

	private applyNow(target: number): void {
		this.lastAppliedAt = this.now();
		this.pendingTarget = null;
		this.apply(target);
	}

	private clearTimer(): void {
		if (this.timerHandle !== null) {
			this.timerHandle.cancel();
			this.timerHandle = null;
		}
	}
}
