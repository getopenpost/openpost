import { describe, expect, it } from 'vitest';
import { formatLinkedSyncOffset, linkedSyncBadgeMinimumWidth } from './linked-sync-display';

describe('linked sync badge display', () => {
	it('formats sub-second, minute, and negative frame offsets', () => {
		expect(formatLinkedSyncOffset(12, 30)).toBe('+00:12');
		expect(formatLinkedSyncOffset(-293, 30)).toBe('-09:23');
		expect(formatLinkedSyncOffset(1_812, 30)).toBe('+01:00:12');
	});

	it('reserves more room for longer timecodes', () => {
		expect(linkedSyncBadgeMinimumWidth('+01:00:12')).toBeGreaterThan(
			linkedSyncBadgeMinimumWidth('+00:12')
		);
	});
});
