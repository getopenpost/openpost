import { describe, expect, it } from 'vitest';
import { toggleMediaTagSelection } from './media-tags';

describe('media tags', () => {
	it('adds and removes tag filters without changing the other selections', () => {
		expect(toggleMediaTagSelection(['campaign'], 'evergreen')).toEqual(['campaign', 'evergreen']);
		expect(toggleMediaTagSelection(['campaign', 'evergreen'], 'campaign')).toEqual(['evergreen']);
	});
});
