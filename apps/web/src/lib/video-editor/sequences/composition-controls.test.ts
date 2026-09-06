import { describe, expect, it } from 'vitest';
import type { CompositionControlSchema, TimelineItem } from '../project/types';
import {
	applyCompositionControlOverrides,
	getCompositionControlCandidates,
	getCompositionControlSourceValue,
	sanitizeCompositionControlSchema
} from './composition-controls';

const text: TimelineItem = {
	id: 'title',
	trackId: 'visual',
	from: 0,
	durationInFrames: 30,
	label: 'Title',
	type: 'text',
	text: 'Source title',
	color: '#ffffff'
};

const shape: TimelineItem = {
	id: 'accent',
	trackId: 'visual',
	from: 0,
	durationInFrames: 30,
	label: 'Accent',
	type: 'shape',
	shapeType: 'rectangle',
	fillColor: '#f97316',
	strokeEnabled: true,
	strokeColor: '#000000'
};

const schema: CompositionControlSchema = {
	version: 1,
	controls: [
		{
			id: 'copy',
			name: 'Headline',
			targetItemId: text.id,
			property: 'text.text',
			kind: 'text',
			defaultValue: 'Source title'
		},
		{
			id: 'accent-color',
			name: 'Accent color',
			targetItemId: shape.id,
			property: 'shape.fillColor',
			kind: 'color',
			defaultValue: '#f97316'
		}
	]
};

describe('composition published controls', () => {
	it('applies per-instance values without mutating the shared source', () => {
		const resolved = applyCompositionControlOverrides([text, shape], schema, {
			copy: 'Instance title',
			'accent-color': '#22c55e'
		});
		expect(resolved[0]).toMatchObject({ text: 'Instance title' });
		expect(resolved[1]).toMatchObject({ fillColor: '#22c55e' });
		expect(text.text).toBe('Source title');
		expect(getCompositionControlSourceValue([text, shape], schema.controls[0]!)).toBe(
			'Source title'
		);
	});

	it('drops invalid, duplicate, and stale definitions when loading', () => {
		const sanitized = sanitizeCompositionControlSchema(
			{
				version: 1,
				controls: [
					...schema.controls,
					{ ...schema.controls[0], id: 'duplicate-target' },
					{ ...schema.controls[0], id: 'stale', targetItemId: 'missing' },
					{ ...schema.controls[0], id: 'wrong-kind', kind: 'color' }
				]
			},
			[text, shape]
		);
		expect(sanitized).toEqual(schema);
	});
});
