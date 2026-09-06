export function validateTtsGenerateRequest(
	text: string,
	isSupported: boolean,
	unsupportedMessage = 'This browser cannot run local speech generation.'
): string {
	const trimmed = text.trim();
	if (!trimmed) throw new Error('Enter some text to synthesize.');
	if (!isSupported) throw new Error(unsupportedMessage);
	return trimmed;
}
