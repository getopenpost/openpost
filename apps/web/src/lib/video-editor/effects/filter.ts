/**
 * Pure serialization of clip effects to a CSS filter string.
 *
 * The same string is valid for `style="filter: …"` on the preview
 * `<video>` element and for canvas `ctx.filter`, because every effect
 * param mirrors CSS filter semantics (see effects/types.ts).
 *
 * Ported from FreeCut (MIT) — item-effect-wrapper.tsx effect stacking,
 * reduced to the CSS filter function subset.
 */

import type { ItemEffect } from './types';
import { effectUnit } from './types';

/** Join enabled effects in list order into one CSS filter value; '' when none.
 * GPU-pipeline effects (`type: 'gpu'`) are skipped — they render through the
 * WebGL2 compositor (effects/gpu/compositor.ts), not CSS filters. */
export function effectsToCssFilter(effects?: ItemEffect[]): string {
	if (!effects || effects.length === 0) return '';
	const parts: string[] = [];
	for (const effect of effects) {
		if (!effect.enabled) continue;
		if (effect.type === 'gpu') continue;
		parts.push(`${effect.type}(${effect.amount}${effectUnit(effect.type)})`);
	}
	return parts.join(' ');
}
