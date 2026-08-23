// oxlint-disable
/**
 * Ported from FreeCut (MIT) - src/shared/timeline/transitions/index.ts
 * Standalone exact FreeCut transition rendering library for OpenPost.
 * Auto-registers all 44 built-in transitions on import.
 */

import { registerBuiltinTransitions } from './register-builtins';

registerBuiltinTransitions();

export { transitionRegistry } from './registry';
export type { TransitionRenderer } from './registry';
export * from './types';
export * from './gpu';
