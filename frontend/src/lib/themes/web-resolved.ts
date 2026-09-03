import type { components } from '$lib/api/types';
import type { WebResolvedTheme } from '$lib/themes/contracts';

type ApiResolvedTheme = components['schemas']['ResolvedTheme'];

const RESOLUTION_SOURCES = new Set(['builtin', 'organization', 'fallback']);
const FALLBACK_REASONS = new Set([
	'missing-theme',
	'unsupported-scheme',
	'invalid-manifest',
	'unsafe-resource',
	'resource-failed'
]);

/**
 * The API returns the same shape as the web runtime contract but leaves the
 * discriminator unions as strings. Normalize them here so the runtime only
 * ever sees contract-valid values; the runtime still re-validates the
 * manifest itself and fails closed to the built-in default.
 */
export function toWebResolvedTheme(theme: ApiResolvedTheme): WebResolvedTheme {
	const source = RESOLUTION_SOURCES.has(theme.source) ? theme.source : 'fallback';
	const fallbackReason =
		theme.fallbackReason && FALLBACK_REASONS.has(theme.fallbackReason)
			? theme.fallbackReason
			: source === 'fallback'
				? 'missing-theme'
				: undefined;
	return { ...theme, source, fallbackReason };
}
