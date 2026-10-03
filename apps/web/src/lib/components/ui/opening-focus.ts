import { tabbable } from 'tabbable';

export function preserveOpeningFocus(
	event: Event,
	getContent: () => HTMLElement | null,
	onOpenAutoFocus?: (event: Event) => void
) {
	onOpenAutoFocus?.(event);
	if (event.defaultPrevented) return;
	event.preventDefault();
	const content = getContent();
	if (!content) return;
	const previousFocus = content.ownerDocument.activeElement;
	// Bits defers opening focus to a frame. A choice made before that frame
	// must keep focus instead of being reset to the first control.
	content.ownerDocument.defaultView?.requestAnimationFrame(() => {
		if (getContent() !== content || !content.isConnected || content.dataset.state !== 'open')
			return;
		const active = content.ownerDocument.activeElement;
		if (content.contains(active) || active !== previousFocus) return;
		const first = tabbable(content, { includeContainer: false, getShadowRoot: true })[0];
		(first ?? content).focus();
	});
}
