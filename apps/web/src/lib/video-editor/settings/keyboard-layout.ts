const PUNCTUATION_CODE_BY_TOKEN = new Map<string, string>([
	['backquote', 'Backquote'],
	['minus', 'Minus'],
	['equal', 'Equal'],
	['bracketleft', 'BracketLeft'],
	['bracketright', 'BracketRight'],
	['backslash', 'Backslash'],
	['semicolon', 'Semicolon'],
	['quote', 'Quote'],
	['comma', 'Comma'],
	['period', 'Period'],
	['slash', 'Slash']
]);

export interface KeyboardLayoutApi {
	getLayoutMap?: () => Promise<ReadonlyMap<string, string>>;
}

export function keyboardCodeForShortcutToken(token: string): string | null {
	if (/^[a-z]$/.test(token)) return `Key${token.toUpperCase()}`;
	if (/^[0-9]$/.test(token)) return `Digit${token}`;
	return PUNCTUATION_CODE_BY_TOKEN.get(token) ?? null;
}

export function keyboardLayoutLabelForToken(
	layoutMap: ReadonlyMap<string, string> | null,
	token: string
): string | null {
	if (!layoutMap) return null;
	const code = keyboardCodeForShortcutToken(token);
	if (!code) return null;
	const label = layoutMap.get(code)?.trim();
	if (!label) return null;
	return label.length === 1 ? label.toUpperCase() : label;
}

export async function loadKeyboardLayoutMap(
	keyboard: KeyboardLayoutApi | undefined
): Promise<ReadonlyMap<string, string> | null> {
	if (!keyboard?.getLayoutMap) return null;
	try {
		return await keyboard.getLayoutMap();
	} catch {
		return null;
	}
}
