export type ClipboardWriter = (value: string) => Promise<void>;

export function isAuthenticatorCodeReady(value: string): boolean {
	return /^\d{6}$/.test(value);
}

export async function copyAuthenticatorSetupKey(
	setupKey: string,
	writeText: ClipboardWriter
): Promise<boolean> {
	if (!setupKey) return false;

	try {
		await writeText(setupKey);
		return true;
	} catch {
		return false;
	}
}
