import { describe, expect, it } from 'vitest';
import {
	buildDopesheetSegmentSpans,
	DOPESHEET_GROUP_ORDER,
	dopesheetPropertyGroup,
	groupDopesheetProperties
} from './keyframe-dopesheet';
import type { EditorKeyframe } from './keyframe-editor';

function keyframe(
	property: 'x' | 'opacity' | 'volume' | 'cropLeft',
	frame: number,
	id: string,
	easing: EditorKeyframe['easing'] = 'linear'
): EditorKeyframe {
	return { property, frame, id, index: 0, value: 0, easing };
}

describe('dopesheetPropertyGroup', () => {
	it('buckets built-in properties like the sheet headers', () => {
		expect(dopesheetPropertyGroup('x')).toBe('transform');
		expect(dopesheetPropertyGroup('opacity')).toBe('transform');
		expect(dopesheetPropertyGroup('cropLeft')).toBe('crop');
		expect(dopesheetPropertyGroup('fontSize')).toBe('typography');
		// SAFETY: test-only probe of the path-prefix branch with a dynamic vertex property name.
		expect(dopesheetPropertyGroup('pathVertex:0:positionX' as 'x')).toBe('path');
		expect(dopesheetPropertyGroup('volume')).toBe('audio');
		// SAFETY: test-only probe of the fallback branch with an unknown effect property name.
		expect(dopesheetPropertyGroup('someEffectParam' as 'x')).toBe('other');
	});

	it('exposes a stable group order', () => {
		expect([...DOPESHEET_GROUP_ORDER]).toEqual([
			'transform',
			'crop',
			'typography',
			'path',
			'audio',
			'other'
		]);
	});
});

describe('groupDopesheetProperties', () => {
	it('orders groups and flags hidden ones instead of dropping them', () => {
		const groups = groupDopesheetProperties(
			['volume', 'x', 'cropLeft', 'opacity'],
			new Set(['crop'])
		);
		expect(groups.map((entry) => entry.group)).toEqual(['transform', 'crop', 'audio']);
		expect(groups[0]).toMatchObject({ group: 'transform', hidden: false });
		expect(groups[0]?.properties).toEqual(['x', 'opacity']);
		expect(groups[1]).toMatchObject({ group: 'crop', hidden: true });
	});

	it('keeps groups listed when everything is hidden', () => {
		const groups = groupDopesheetProperties(['x'], new Set(DOPESHEET_GROUP_ORDER));
		expect(groups).toHaveLength(1);
		expect(groups[0]).toMatchObject({ group: 'transform', hidden: true });
	});
});

describe('buildDopesheetSegmentSpans', () => {
	it('builds one span per consecutive pair carrying the left easing', () => {
		const keyframes = [
			keyframe('x', 30, 'c', 'easeOut'),
			keyframe('x', 10, 'a', 'linear'),
			keyframe('x', 20, 'b', 'easeIn')
		];
		const spans = buildDopesheetSegmentSpans(keyframes);
		expect(spans).toHaveLength(2);
		expect(spans[0]).toMatchObject({ fromId: 'a', fromFrame: 10, toFrame: 20, easing: 'linear' });
		expect(spans[1]).toMatchObject({ fromId: 'b', fromFrame: 20, toFrame: 30, easing: 'easeIn' });
	});

	it('keeps lanes separate and skips degenerate pairs', () => {
		const keyframes = [
			keyframe('x', 10, 'a'),
			keyframe('x', 10, 'same'),
			keyframe('opacity', 5, 'o1'),
			keyframe('volume', 0, 'lonely')
		];
		const spans = buildDopesheetSegmentSpans(keyframes);
		expect(spans).toEqual([]);
		const withPair = buildDopesheetSegmentSpans([
			...keyframes,
			keyframe('opacity', 15, 'o2', 'hold')
		]);
		expect(withPair).toHaveLength(1);
		expect(withPair[0]).toMatchObject({
			property: 'opacity',
			fromFrame: 5,
			toFrame: 15,
			easing: 'linear'
		});
	});
});
