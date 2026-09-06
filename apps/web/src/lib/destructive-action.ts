import {
	completeDestructiveAction,
	type DestructiveActionOutcome
} from './destructive-action-outcome';
import { showToast } from './toast';

export function requestDestructiveAction(
	event: Pick<MouseEvent, 'shiftKey'>,
	confirm: () => void,
	execute: () => DestructiveActionOutcome | Promise<DestructiveActionOutcome>,
	notify: typeof showToast = showToast
): void | Promise<DestructiveActionOutcome> {
	if (event.shiftKey) {
		return Promise.resolve(execute()).then(async (outcome) => {
			if (!outcome.ok && outcome.message) notify(outcome.message, 'error');
			else await completeDestructiveAction(outcome, null, notify);
			return outcome;
		});
	}
	confirm();
}

export interface DestructiveSequenceOutcome<T> {
	remaining: T[];
	error?: unknown;
}

export async function runDestructiveSequence<T>(
	targets: T[],
	execute: (target: T) => Promise<void>
): Promise<DestructiveSequenceOutcome<T>> {
	for (let index = 0; index < targets.length; index += 1) {
		try {
			await execute(targets[index]);
		} catch (error) {
			return { remaining: targets.slice(index), error };
		}
	}
	return { remaining: [] };
}
