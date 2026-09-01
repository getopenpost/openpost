import { describe, expect, it, vi } from 'vitest';
import { createQuerySessionGuard } from './session';

describe('query session guard', () => {
	it('clears cached API data only when the settled account identity changes', () => {
		const clear = vi.fn();
		const guard = createQuerySessionGuard({ clear });

		guard.observe({ isLoading: true, isAuthenticated: false, userId: null });
		guard.observe({ isLoading: false, isAuthenticated: false, userId: null });
		guard.observe({ isLoading: false, isAuthenticated: false, userId: null });
		expect(clear).not.toHaveBeenCalled();

		guard.observe({ isLoading: false, isAuthenticated: true, userId: 'user-1' });
		guard.observe({ isLoading: false, isAuthenticated: true, userId: 'user-1' });
		expect(clear).toHaveBeenCalledTimes(1);

		guard.observe({ isLoading: false, isAuthenticated: true, userId: 'user-2' });
		guard.observe({ isLoading: false, isAuthenticated: false, userId: null });
		expect(clear).toHaveBeenCalledTimes(3);
	});
});
