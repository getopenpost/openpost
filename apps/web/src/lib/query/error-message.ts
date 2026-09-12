export function readQueryErrorMessage(cause: unknown): string | undefined {
	if (cause === null || typeof cause !== 'object' || !('message' in cause)) return undefined;
	return typeof cause.message === 'string' ? cause.message : undefined;
}
