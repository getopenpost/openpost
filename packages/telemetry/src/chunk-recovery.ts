/**
 * Shared bounded recovery for failed dynamic imports (stale deployments).
 *
 * Both the marketing site and the application use this controller through thin
 * surface adapters in their `hooks.client.ts` files. The policy:
 *
 * - One recovery decision per failure. A per-document single-flight guard and
 *   same-error deduplication stop one failure that arrives through several
 *   event sources (`vite:preloadError`, `unhandledrejection`, SvelteKit
 *   `handleError`) from consuming several attempts.
 * - Automatic reload only with evidence that it helps: a verified build change
 *   between the running build and an uncached current-build response, or a
 *   diagnostic probe of the failed first-party asset (missing means deployment
 *   skew, present means a transient failure worth one retry). Offline,
 *   same-build, and unclassified failures get a manual retry state instead.
 * - Bounded persisted budget: at most one automatic reload per failing asset
 *   (or per client-build/target-build pair when both builds are known), with
 *   an overall bound. Eligibility never resets merely because time elapsed.
 * - No automatic reload when the budget cannot be persisted. An in-memory flag
 *   cannot prevent a loop across full page reloads, so unpersistable state
 *   falls back to an explicit reload action.
 * - Unsupported-browser failures (for example a regex engine that cannot
 *   compile lookbehind) never reload. Fetching the same bytes again cannot add
 *   the missing capability.
 * - Rejected imports stay rejected. This controller never calls
 *   `preventDefault()` on Vite's preload event: cancelling it turns a failed
 *   route import into `undefined` and breaks SvelteKit's error boundary.
 */

export interface ChunkRecoveryBudget {
  total: number;
  perAsset: Record<string, number>;
}

export interface ManualRecoveryInfo {
  assetPath: string | null;
  reason:
    | "offline"
    | "manual-policy"
    | "unpersistable"
    | "budget-exhausted"
    | "same-build"
    | "probe-failed"
    | "unclassified";
  probeStatus: number | null;
}

export type ChunkRecoveryDecision =
  | { kind: "reloaded"; assetPath: string | null; attempt: number }
  | ({ kind: "manual" } & ManualRecoveryInfo)
  | {
      kind: "ignored";
      reason: "unrelated" | "unsupported-browser" | "single-flight" | "duplicate";
    };

export interface ChunkRecoveryRuntime {
  online?: () => boolean;
  fetchAssetStatus?: (pathname: string) => Promise<number | null>;
  loadBudget?: () => ChunkRecoveryBudget | null;
  saveBudget?: (budget: ChunkRecoveryBudget) => void;
  scheduleReload?: (delayMs: number) => void;
  notifyManual?: (info: ManualRecoveryInfo) => void;
}

export interface ChunkRecoveryOptions extends ChunkRecoveryRuntime {
  /** Build identifier of the running page, when the surface knows it. */
  runningBuild?: string;
  /**
   * Verified deployment-change check, such as SvelteKit's `updated.check()`.
   * Used only for URL-less import failures, where no asset exists to probe:
   * `true` means a newer deployment is confirmed, `false` means the running
   * deployment is current, and `null` (or a throw) means unknown. The
   * controller never guesses from this signal.
   */
  checkForUpdate?: () => Promise<boolean | null>;
  /** Uncached probe of the currently served build, when the surface has one. */
  fetchCurrentBuild?: () => Promise<string | null>;
  /**
   * Surface gate for automatic reloads. Marketing allows them; editors pass a
   * check that refuses while unsaved state, recording, or exports exist so a
   * reload can never silently discard work.
   */
  canAutoReload?: () => boolean;
  maxAutomaticRecoveries?: number;
}

const STORAGE_KEY = "openpost:chunk-recovery:v1";
const DEFAULT_MAX_AUTOMATIC_RECOVERIES = 3;
const RELOAD_DELAYS_MS = [300, 800, 1500];

export function isChunkLoadErrorMessage(message: string): boolean {
  if (message.includes("Failed to fetch dynamically imported module")) return true;
  // Firefox reports the same stale-deployment failure with different wording.
  if (message.toLowerCase().includes("error loading dynamically imported module")) return true;
  if (message.includes("Importing a module script failed")) return true;
  if (message.includes("Failed to fetch") && message.includes("/_app/immutable/")) return true;
  // Vite dev transform race on generated SvelteKit client nodes.
  if (message.includes("Failed to load url") && message.includes("_app/")) return true;
  return false;
}

export function isChunkLoadError(error: unknown): boolean {
  return isChunkLoadErrorMessage(errorMessage(error));
}

/**
 * Syntax failures from engines missing a language feature (Safari < 16.4
 * cannot compile regex lookbehind, reported as "invalid group specifier
 * name"). Reloading identical bytes into the same engine cannot fix these.
 */
export function isUnsupportedBrowserError(error: unknown): boolean {
  if (error instanceof SyntaxError) {
    const message = error.message;
    if (/invalid group specifier name/i.test(message)) return true;
    if (/lookbehind/i.test(message)) return true;
  }
  if (error instanceof Error && /lookbehind/i.test(error.message)) return true;
  return false;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

/**
 * Keep only a same-origin first-party immutable asset pathname from an import
 * failure message. Query strings and fragments are stripped. Anything else is
 * unknown, not automatically a stale deployment.
 */
export function extractFirstPartyAssetPath(message: string): string | null {
  const candidates = message.match(/(?:https?:\/\/[^\s'")\]]+|\/[^\s'")\]]+)/g);
  if (!candidates) return null;
  for (const candidate of candidates) {
    const withoutSuffix = candidate.replace(/[?#].*$/, "").replace(/[.,;:]+$/, "");
    let pathname: string;
    try {
      pathname = new URL(withoutSuffix, "https://openpost.invalid").pathname;
    } catch {
      continue;
    }
    if (pathname.startsWith("/_app/immutable/") && /\.(?:m?js|css)$/.test(pathname)) {
      return pathname;
    }
  }
  return null;
}

function defaultRuntime(): Required<ChunkRecoveryRuntime> {
  return {
    online: () => (typeof navigator === "undefined" ? true : navigator.onLine),
    fetchAssetStatus: async (pathname: string) => {
      try {
        const response = await fetch(pathname, {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
        });
        return response.status;
      } catch {
        return null;
      }
    },
    loadBudget: () => {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      const budget = parsed as Partial<ChunkRecoveryBudget>;
      if (
        typeof budget.total !== "number" ||
        !budget.perAsset ||
        typeof budget.perAsset !== "object"
      ) {
        return null;
      }
      return { total: budget.total, perAsset: { ...budget.perAsset } };
    },
    saveBudget: (budget: ChunkRecoveryBudget) => {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(budget));
    },
    scheduleReload: (delayMs: number) => {
      window.setTimeout(() => window.location.reload(), delayMs);
    },
    notifyManual: () => undefined,
  };
}

export interface ChunkRecoveryController {
  recover: (error: unknown) => Promise<ChunkRecoveryDecision>;
  install: () => () => void;
}

export function createChunkRecovery(options: ChunkRecoveryOptions = {}): ChunkRecoveryController {
  const runtime = { ...defaultRuntime(), ...options };
  const maxAutomatic = options.maxAutomaticRecoveries ?? DEFAULT_MAX_AUTOMATIC_RECOVERIES;
  let inFlight = false;
  let reloadScheduled = false;
  const seen = new WeakSet<object>();
  let activeDecision: Promise<ChunkRecoveryDecision> | null = null;
  let scheduledReloadDecision: ChunkRecoveryDecision | null = null;

  async function recover(error: unknown): Promise<ChunkRecoveryDecision> {
    if (isUnsupportedBrowserError(error)) return { kind: "ignored", reason: "unsupported-browser" };
    const message = errorMessage(error);
    if (!isChunkLoadErrorMessage(message)) return { kind: "ignored", reason: "unrelated" };
    if (scheduledReloadDecision) return scheduledReloadDecision;
    if (typeof error === "object" && error !== null) {
      if (seen.has(error)) return activeDecision ?? { kind: "ignored", reason: "duplicate" };
      seen.add(error);
    }
    // One failure can arrive through preload, boundary, and global
    // rejection handlers. Decide once per document.
    if (inFlight) return activeDecision ?? { kind: "ignored", reason: "single-flight" };
    inFlight = true;
    const decision = decide(message)
      .then((result) => {
        if (result.kind === "reloaded") scheduledReloadDecision = result;
        return result;
      })
      .finally(() => {
        // A scheduled reload navigates away with the flag set, which keeps
        // late duplicate events from scheduling a second navigation.
        // Manual/ignored outcomes clear it so an explicit retry can proceed.
        if (!reloadScheduled) inFlight = false;
        activeDecision = null;
      });
    activeDecision = decision;
    return decision;
  }

  async function decide(message: string): Promise<ChunkRecoveryDecision> {
    const assetPath = extractFirstPartyAssetPath(message);

    if (!runtime.online()) {
      return manual(assetPath, "offline", null);
    }
    if (!(options.canAutoReload?.() ?? true)) {
      return manual(assetPath, "manual-policy", null);
    }

    // A verified build change is direct evidence of deployment skew.
    if (options.runningBuild && options.fetchCurrentBuild) {
      let current: string | null = null;
      try {
        current = await options.fetchCurrentBuild();
      } catch {
        current = null;
      }
      if (current && current !== options.runningBuild) {
        return autoReload(assetPath ?? `${options.runningBuild}->${current}`);
      }
      if (current && !assetPath) {
        return manual(null, "same-build", null);
      }
      // Same build with a known asset still deserves the asset probe
      // below; a same build without an asset has no recovery evidence.
    }

    if (!assetPath) {
      // URL-less failure: only a verified deployment change justifies a
      // reload. A confirmed newer deployment reloads once per running
      // build; anything else keeps the explicit retry.
      if (options.checkForUpdate) {
        let changed: boolean | null = null;
        try {
          changed = await options.checkForUpdate();
        } catch {
          changed = null;
        }
        if (changed === true) {
          return autoReload(`stale-update:${options.runningBuild ?? "unknown"}`);
        }
        if (changed === false) return manual(null, "same-build", null);
      }
      return manual(null, "unclassified", null);
    }

    let probeStatus: number | null = null;
    try {
      probeStatus = await runtime.fetchAssetStatus(assetPath);
    } catch {
      probeStatus = null;
    }
    if (probeStatus === null) {
      // A later probe is not the original request. Unknown stays unknown.
      return manual(assetPath, "probe-failed", null);
    }
    if (probeStatus === 404 || probeStatus === 410) {
      return autoReload(assetPath);
    }
    if (probeStatus >= 200 && probeStatus < 300) {
      // Asset still served: transient failure, one bounded retry.
      return autoReload(assetPath);
    }
    return manual(assetPath, "probe-failed", probeStatus);
  }

  function manual(
    assetPath: string | null,
    reason: ManualRecoveryInfo["reason"],
    probeStatus: number | null,
  ): ChunkRecoveryDecision {
    const info: ManualRecoveryInfo = { assetPath, reason, probeStatus };
    try {
      runtime.notifyManual?.(info);
    } catch {
      // Manual-state listeners must not break error handling.
    }
    return { kind: "manual", ...info };
  }

  function autoReload(pairKey: string): ChunkRecoveryDecision {
    let budget: ChunkRecoveryBudget | null;
    try {
      budget = runtime.loadBudget() ?? { total: 0, perAsset: {} };
    } catch {
      return unpersistable(pairKey);
    }
    if ((budget.perAsset[pairKey] ?? 0) >= 1 || budget.total >= maxAutomatic) {
      return manual(pairKey.startsWith("/") ? pairKey : null, "budget-exhausted", null);
    }
    const next: ChunkRecoveryBudget = {
      total: budget.total + 1,
      perAsset: { ...budget.perAsset, [pairKey]: (budget.perAsset[pairKey] ?? 0) + 1 },
    };
    try {
      runtime.saveBudget(next);
    } catch {
      // Without persisted state a reload could loop across documents.
      return unpersistable(pairKey);
    }
    reloadScheduled = true;
    const delayMs = RELOAD_DELAYS_MS[Math.min(next.total - 1, RELOAD_DELAYS_MS.length - 1)] ?? 1500;
    try {
      runtime.scheduleReload(delayMs);
    } catch {
      reloadScheduled = false;
      return unpersistable(pairKey);
    }
    return {
      kind: "reloaded",
      assetPath: pairKey.startsWith("/") ? pairKey : null,
      attempt: next.total,
    };
  }

  function unpersistable(pairKey: string): ChunkRecoveryDecision {
    const info: ManualRecoveryInfo = {
      assetPath: pairKey.startsWith("/") ? pairKey : null,
      reason: "unpersistable",
      probeStatus: null,
    };
    try {
      runtime.notifyManual?.(info);
    } catch {
      // Manual-state listeners must not break error handling.
    }
    return { kind: "manual", ...info };
  }

  function install(): () => void {
    if (typeof window === "undefined") return () => undefined;
    const onError = (event: Event) => {
      const errorEvent = event as Event & { error?: unknown; message?: string };
      void recover(errorEvent.error ?? errorEvent.message);
    };
    const onUnhandledRejection = (event: Event) => {
      const rejectionEvent = event as Event & { reason?: unknown };
      void recover(rejectionEvent.reason);
    };
    const onPreloadError = (event: Event) => {
      const preloadEvent = event as Event & { payload?: unknown; detail?: unknown };
      // Never preventDefault here: cancelling Vite's event turns the
      // rejected import into undefined and breaks SvelteKit's boundary.
      void recover(preloadEvent.payload ?? preloadEvent.detail);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    window.addEventListener("vite:preloadError", onPreloadError as EventListener);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      window.removeEventListener("vite:preloadError", onPreloadError as EventListener);
    };
  }

  return { recover, install };
}

/** Convenience for surfaces that only need the listeners with default behavior. */
export function installChunkRecovery(options: ChunkRecoveryOptions = {}): () => void {
  return createChunkRecovery(options).install();
}
