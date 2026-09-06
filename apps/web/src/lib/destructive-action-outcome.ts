import { tick } from 'svelte';
import { showToast } from './toast';

export interface DestructiveActionOutcome {
	ok: boolean;
	message?: string;
	successMessage?: string;
	returnFocus?: HTMLElement | null;
}

function safeDocumentFocus(): HTMLElement | null {
	if (typeof document === 'undefined') return null;
	const target =
		['[data-destructive-focus-fallback]', 'main h1', '[role="main"] h1', 'main', '[role="main"]']
			.map((selector) => document.querySelector<HTMLElement>(selector))
			.find((candidate) => candidate !== null) ?? null;
	if (target && target.tabIndex < 0) target.tabIndex = -1;
	return target;
}

export async function completeDestructiveAction(
	outcome: DestructiveActionOutcome,
	fallbackFocus: HTMLElement | null = null,
	notify: typeof showToast = showToast
): Promise<void> {
	if (!outcome.ok) return;
	if (outcome.successMessage) notify(outcome.successMessage, 'success');
	await tick();
	const focusTarget = outcome.returnFocus ?? fallbackFocus;
	(focusTarget?.isConnected === false ? null : focusTarget)?.focus();
	if (!focusTarget || focusTarget.isConnected === false) safeDocumentFocus()?.focus();
}
