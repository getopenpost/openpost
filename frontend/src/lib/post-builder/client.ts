import { postBuilderRunIsActive } from './mapping';
import type { PostBuilderClient, PostBuilderRun } from './types';

export interface WatchPostBuilderRunOptions {
	initialRun?: PostBuilderRun;
	intervalMs?: number;
	signal?: AbortSignal;
	onUpdate?: (run: PostBuilderRun) => void;
	wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

function abortError(): Error {
	const error = new Error('The build watch was cancelled.');
	error.name = 'AbortError';
	return error;
}

export function abortableWait(milliseconds: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) return Promise.reject(abortError());
	return new Promise((resolve, reject) => {
		const cancel = () => {
			clearTimeout(timeout);
			signal?.removeEventListener('abort', cancel);
			reject(abortError());
		};
		const finish = () => {
			signal?.removeEventListener('abort', cancel);
			resolve();
		};
		const timeout = setTimeout(finish, Math.max(0, milliseconds));
		if (!signal) return;
		signal.addEventListener('abort', cancel, { once: true });
	});
}

export function isPostBuilderAbort(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}

export async function watchPostBuilderRun(
	client: PostBuilderClient,
	runId: string,
	options: WatchPostBuilderRunOptions = {}
): Promise<PostBuilderRun> {
	const wait = options.wait ?? abortableWait;
	const intervalMs = Math.max(0, options.intervalMs ?? 1_200);
	let run = options.initialRun ?? (await client.load(runId, { signal: options.signal }));
	options.onUpdate?.(run);

	while (postBuilderRunIsActive(run)) {
		await wait(intervalMs, options.signal);
		if (options.signal?.aborted) throw abortError();
		run = await client.load(runId, { signal: options.signal });
		options.onUpdate?.(run);
	}

	return run;
}
