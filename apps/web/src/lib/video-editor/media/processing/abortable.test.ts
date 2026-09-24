// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { abortable } from './abortable';

const abortError = () => new DOMException('Cancelled.', 'AbortError');

describe('abortable', () => {
	it('rejects promptly while safely ignoring a late result', async () => {
		let finish!: (value: string) => void;
		const operation = new Promise<string>((resolve) => (finish = resolve));
		const controller = new AbortController();
		const result = abortable(operation, controller.signal, abortError);
		controller.abort();
		await expect(result).rejects.toMatchObject({ name: 'AbortError' });
		finish('late');
		await Promise.resolve();
	});
});
