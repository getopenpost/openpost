import { describe, expect, it } from 'vitest';
import { toggleMediaTagSelection } from './media-tags';

describe('toggleMediaTagSelection', () => {
	it('appends an unselected tag without mutating or reordering the selection', () => {
		const selected = ['campaign'];
		expect(toggleMediaTagSelection(selected, 'evergreen')).toEqual(['campaign', 'evergreen']);
		expect(selected).toEqual(['campaign']);
	});

	it('removes a selected tag and keeps the remaining order intact', () => {
		const selected = ['campaign', 'evergreen'];
		expect(toggleMediaTagSelection(selected, 'campaign')).toEqual(['evergreen']);
		expect(selected).toEqual(['campaign', 'evergreen']);
	});

	it('removes every matching selection when the id appears more than once', () => {
		expect(toggleMediaTagSelection(['campaign', 'evergreen', 'campaign'], 'campaign')).toEqual([
			'evergreen'
		]);
	});
});
