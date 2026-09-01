interface QueryCacheController {
	clear(): void;
}

interface QuerySessionState {
	isLoading: boolean;
	isAuthenticated: boolean;
	userId: string | null;
}

export function createQuerySessionGuard(queryCache: QueryCacheController) {
	let settled = false;
	let identity = '';

	return {
		observe(state: QuerySessionState) {
			if (state.isLoading) return;
			const nextIdentity = state.isAuthenticated
				? `user:${state.userId || 'unknown'}`
				: 'anonymous';
			if (!settled) {
				settled = true;
				identity = nextIdentity;
				return;
			}
			if (identity === nextIdentity) return;
			identity = nextIdentity;
			queryCache.clear();
		}
	};
}
