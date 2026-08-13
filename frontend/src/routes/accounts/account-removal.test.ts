import { describe, expect, it } from 'vitest';
import { accountRemovalKinds, grantDestinationCount } from './account-removal';

describe('account removal policy', () => {
	it('offers destination-only disconnect and grant revocation for shared grants', () => {
		const account = { grant_destination_count: 3, shared_grant: true };

		expect(grantDestinationCount(account)).toBe(3);
		expect(accountRemovalKinds(account)).toEqual(['disconnect-destination', 'remove-grant']);
	});

	it('offers only credential-clearing revocation for the last destination', () => {
		const account = { grant_destination_count: 1, shared_grant: false };

		expect(grantDestinationCount(account)).toBe(1);
		expect(accountRemovalKinds(account)).toEqual(['remove-grant']);
	});

	it('fails safe when shared metadata and the reported count disagree', () => {
		const account = { grant_destination_count: 0, shared_grant: true };

		expect(grantDestinationCount(account)).toBe(2);
		expect(accountRemovalKinds(account)).toEqual(['disconnect-destination', 'remove-grant']);
	});
});
