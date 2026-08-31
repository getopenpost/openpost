import { describe, expect, it } from 'vitest';
import { eventMatchesShortcut, formatShortcutBindingWithLabels } from './keyboard-shortcuts';
import {
	keyboardLayoutLabelForToken,
	loadKeyboardLayoutMap,
	type KeyboardLayoutApi
} from './keyboard-layout';

describe('keyboard layout labels', () => {
	it('labels a physical binding from an AZERTY map without changing what key triggers it', () => {
		const layout = new Map([
			['KeyA', 'q'],
			['KeyQ', 'a'],
			['Comma', ';']
		]);
		const labelForToken = (token: string) => keyboardLayoutLabelForToken(layout, token);

		expect(formatShortcutBindingWithLabels('mod+a', { platform: 'MacIntel', labelForToken })).toBe(
			'Cmd + Q'
		);
		expect(formatShortcutBindingWithLabels('comma', { platform: 'MacIntel', labelForToken })).toBe(
			';'
		);
		expect(eventMatchesShortcut({ code: 'KeyA', key: 'q', metaKey: true }, 'mod+a')).toBe(true);
		expect(eventMatchesShortcut({ code: 'KeyQ', key: 'a', metaKey: true }, 'mod+a')).toBe(false);
	});

	it('falls back cleanly when the browser cannot report its layout', async () => {
		const denied: KeyboardLayoutApi = {
			getLayoutMap: async () => {
				throw new DOMException('Denied', 'NotAllowedError');
			}
		};

		await expect(loadKeyboardLayoutMap(undefined)).resolves.toBeNull();
		await expect(loadKeyboardLayoutMap(denied)).resolves.toBeNull();
		expect(keyboardLayoutLabelForToken(null, 'a')).toBeNull();
		expect(formatShortcutBindingWithLabels('mod+a', { platform: 'MacIntel' })).toBe('Cmd + A');
	});
});
