import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeClipboardText } from './clipboard';

describe('clipboard writes', () => {
	afterEach(() => vi.restoreAllMocks());

	it('falls back to a same-click document copy when permission is denied', async () => {
		vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('permission denied'));
		const execCommand = vi.spyOn(document, 'execCommand').mockImplementation(() => {
			const textarea = document.body.querySelector('textarea');
			expect(textarea?.value).toBe('token-value');
			expect(textarea?.selectionStart).toBe(0);
			expect(textarea?.selectionEnd).toBe('token-value'.length);
			return true;
		});

		await expect(writeClipboardText('token-value')).resolves.toBeUndefined();
		expect(execCommand).toHaveBeenCalledWith('copy');
		expect(document.body.querySelector('textarea')).toBeNull();
	});
});
