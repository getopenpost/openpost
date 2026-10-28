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
