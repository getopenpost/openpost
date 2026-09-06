export async function writeClipboardText(value: string): Promise<void> {
	if (!globalThis.navigator?.clipboard?.writeText) throw new Error('Clipboard unavailable');
	await navigator.clipboard.writeText(value);
}
