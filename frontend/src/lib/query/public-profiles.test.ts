import { describe, expect, it, vi } from 'vitest';
import { createPublicProfileQueryAPI } from './public-profiles';

describe('public profile query API', () => {
	it('loads the named profile with the request signal', async () => {
		const profile = { username: 'founder' };
		const GET = vi.fn(async () => ({
			data: profile,
			response: new Response(null, { status: 200 })
		}));
		const api = createPublicProfileQueryAPI({ GET } as never);
		const signal = new AbortController().signal;

		await expect(api.getPublicProfile('founder', signal)).resolves.toBe(profile);
		expect(GET).toHaveBeenCalledWith('/public/profiles/{username}', {
			params: { path: { username: 'founder' } },
			signal
		});
	});
});
