const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Whether the visitor asked for reduced motion. `false` without a window. */
export const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" && window.matchMedia(REDUCED_MOTION_QUERY).matches;

/** Call `onChange` when the reduced-motion preference flips. Returns the unsubscribe function. */
export const watchReducedMotion = (onChange: (reduced: boolean) => void): (() => void) => {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  const listener = () => onChange(query.matches);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
};

/**
 * `running`: drawing every frame. `paused`: offscreen or the tab is hidden.
 * `static`: motion is off (reduced motion or `enabled: false`), so the
 * callback ran once for a still frame.
 */
export type FrameLoopState = "running" | "paused" | "static";

/**
 * Called once per drawn frame with the seconds of motion so far (frozen
 * while paused) and the seconds since the previous frame (at most 0.1).
 * For the still frame drawn when motion is off, `delta` is 0 and `time` is
 * `stillTime`.
 */
export type FrameLoopCallback = (time: number, delta: number) => void;

export interface FrameLoopOptions {
  /** Pause while this element is offscreen. Omit to ignore visibility. */
  target?: Element | null;
  /** `false` holds a still frame, as reduced motion does. Default `true`. */
  enabled?: boolean;
  /** Frame rate cap. Default 30, which keeps slow drifts smooth. */
  fps?: number;
  /** The `time` passed for the still frame. Default 0. */
  stillTime?: number;
  /** Margin around the viewport that still counts as visible. Default `120px`. */
  rootMargin?: string;
  /** Told when the loop changes state, never per frame. */
  onState?: (state: FrameLoopState) => void;
}

export interface FrameLoop {
  /** Replace the callback without restarting. */
  setCallback: (callback: FrameLoopCallback) => void;
  /** Change `enabled`, `fps` or `stillTime`. */
  update: (options: Pick<FrameLoopOptions, "enabled" | "fps" | "stillTime">) => void;
  /** Current state. */
  state: () => FrameLoopState;
  destroy: () => void;
}

// One long frame (a tab switch, a debugger) must not jump the motion.
const MAX_DELTA = 0.1;

/**
 * A requestAnimationFrame loop that runs only when it can be seen. It
 * pauses offscreen and in hidden tabs, and under reduced motion (or
 * `enabled: false`) it calls `callback` once with `stillTime` instead.
 */
export const createFrameLoop = (
  initial: FrameLoopCallback,
  {
    target,
    enabled: initialEnabled = true,
    fps: initialFps = 30,
    stillTime: initialStill = 0,
    rootMargin = "120px",
    onState,
  }: FrameLoopOptions = {},
): FrameLoop => {
  let callback = initial;
  let enabled = initialEnabled;
  let fps = initialFps;
  let stillTime = initialStill;
  let reduced = prefersReducedMotion();
  let visible = document.visibilityState === "visible";
  let onScreen = !target;
  let frame = 0;
  let time = 0;
  let current: FrameLoopState | null = null;
  let lastTick = 0;
  let lastDraw = -Infinity;

  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    const delta = Math.min((now - lastTick) / 1000, MAX_DELTA);
    lastTick = now;
    time += delta;
    const interval = 1000 / Math.max(1, fps);
    // A small tolerance so 60Hz screens hit 30fps evenly.
    if (now - lastDraw >= interval - 2) {
      const sinceDraw = Math.min((now - lastDraw) / 1000, MAX_DELTA);
      lastDraw = now;
      callback(time, sinceDraw);
    }
  };

  const settle = () => {
    const next: FrameLoopState =
      reduced || !enabled ? "static" : visible && onScreen ? "running" : "paused";
    if (next === current) return;
    current = next;
    cancelAnimationFrame(frame);
    frame = 0;
    if (next === "static") {
      callback(stillTime, 0);
    } else if (next === "running") {
      lastTick = performance.now();
      lastDraw = -Infinity;
      frame = requestAnimationFrame(tick);
    }
    onState?.(next);
  };

  const onVisibility = () => {
    visible = document.visibilityState === "visible";
    settle();
  };
  document.addEventListener("visibilitychange", onVisibility);
  const stopReduced = watchReducedMotion((value) => {
    reduced = value;
    settle();
  });
  const observer = target
    ? new IntersectionObserver(
        ([entry]) => {
          onScreen = entry?.isIntersecting ?? false;
          settle();
        },
        { rootMargin },
      )
    : null;
  if (target) observer?.observe(target);
  settle();

  return {
    destroy: () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      stopReduced();
      document.removeEventListener("visibilitychange", onVisibility);
    },
    setCallback: (next) => {
      callback = next;
    },
    state: () => current ?? "paused",
    update: (options) => {
      const stillChanged = options.stillTime !== undefined && options.stillTime !== stillTime;
      enabled = options.enabled ?? enabled;
      fps = options.fps ?? fps;
      stillTime = options.stillTime ?? stillTime;
      if (stillChanged && current === "static") callback(stillTime, 0);
      settle();
    },
  };
};
