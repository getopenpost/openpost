export function requestDestructiveAction(
	event: Pick<MouseEvent, 'shiftKey'>,
	confirm: () => void,
	execute: () => void | Promise<void>
): void | Promise<void> {
	if (event.shiftKey) return execute();
	confirm();
}
