// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { abortable } from './abortable';

const abortError = () => new DOMException('Cancelled.', 'AbortError');

describe('abortable', () => {
	it.each([false, true])(
		'handles late failures when already cancelled: %s',
		async (alreadyCancelled) => {
			let fail!: (error: Error) => void;
			const operation = new Promise<never>((_, reject) => (fail = reject));
			const controller = new AbortController();
			const unhandled = vi.fn();
			process.on('unhandledRejection', unhandled);
			try {
				if (alreadyCancelled) controller.abort();
				const result = abortable(operation, controller.signal, abortError);
				controller.abort();
				await expect(result).rejects.toMatchObject({ name: 'AbortError' });
				fail(new Error('The retired source failed to load.'));
				await new Promise((resolve) => setTimeout(resolve, 0));
				expect(unhandled).not.toHaveBeenCalled();
			} finally {
				process.off('unhandledRejection', unhandled);
			}
		}
	);

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
