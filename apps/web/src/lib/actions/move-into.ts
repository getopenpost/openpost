/**
 * Moves a mounted node into `target` and back, without re-rendering it. Use it
 * when one live component instance must appear in different places, such as
 * the Ideas builder moving between its page and its dialog. The node stays
 * hidden while it has no target, so it never renders where it was declared.
 */
export function moveInto(node: HTMLElement, target: HTMLElement | undefined) {
	const anchor = document.createComment('move-into');
	node.before(anchor);
	function place(next: HTMLElement | undefined) {
		node.hidden = !next;
		if (next) next.append(node);
		else anchor.after(node);
	}
	place(target);
	return {
		update: place,
		destroy() {
			node.remove();
			anchor.remove();
		}
	};
}
