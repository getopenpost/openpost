import { describe, expect, it } from 'vitest';
import { buildTimelineEqPatchFromSettings } from './audio-eq-ui';

describe('audio EQ UI patches', () => {
	it('maps only the edited native EQ fields to clip storage fields', () => {
		expect(buildTimelineEqPatchFromSettings({ enabled: false, lowGainDb: 3 })).toEqual({
			audioEqEnabled: false,
			audioEqLowGainDb: 3
		});
	});
});
