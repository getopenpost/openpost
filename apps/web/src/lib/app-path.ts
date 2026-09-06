import { resolve } from '$app/paths';
import type { PathnameWithSearchOrHash, ResolvedPathname } from '$app/types';

type RuntimePathResolver = (path: PathnameWithSearchOrHash) => ResolvedPathname;

// SAFETY: This narrows SvelteKit's generic overload set to its single-pathname behavior. The
// wrapper below validates runtime strings before invoking it.
const resolveRuntimePath = resolve as RuntimePathResolver;

export function resolveAppPath(path: string): ResolvedPathname {
	if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) {
		throw new Error('OpenPost app paths must be root-relative.');
	}
	// SAFETY: SvelteKit's generated pathname union cannot represent server-provided redirects or
	// assembled queries. The root-relative checks above establish the resolver's runtime contract.
	return resolveRuntimePath(path as PathnameWithSearchOrHash);
}
