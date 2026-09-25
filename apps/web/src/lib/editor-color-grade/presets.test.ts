import { describe, expect, it } from 'vitest';
import { EDITOR_COLOR_GRADE_PRESETS } from './presets';

describe('shared editor color presets', () => {
	it('keeps Original adjustments neutral so the preset is a no-op', () => {
		expect(EDITOR_COLOR_GRADE_PRESETS[0]?.id).toBe('original');
		expect(EDITOR_COLOR_GRADE_PRESETS[0]?.adjustments).toEqual({});
	});
});
