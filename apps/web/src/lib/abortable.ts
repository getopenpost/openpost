/**
 * Stop waiting for work that cannot consume an AbortSignal itself.
 *
 * The underlying operation may still finish, but its result is ignored and its rejection remains handled.
 * This keeps cancellation prompt while OPFS and blob-resolution APIs remain non-abortable.
 */
export function abortable<T>(
	operation: Promise<T>,
	signal: AbortSignal,
	createAbortError: () => Error
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => {
			cleanup();
			reject(createAbortError());
		};
		const cleanup = () => signal.removeEventListener('abort', onAbort);
		operation.then(
			(value) => {
				cleanup();
				resolve(value);
			},
			(error: Error) => {
				cleanup();
				reject(error);
			}
		);
		if (signal.aborted) onAbort();
		else signal.addEventListener('abort', onAbort, { once: true });
	});
}
