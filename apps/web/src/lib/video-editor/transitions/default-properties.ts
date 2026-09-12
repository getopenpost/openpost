import type { TransitionPropertyValue } from '../project/types';
import type { TransitionDefinition } from './types';

export function defaultTransitionProperties(
	definition: TransitionDefinition
): Record<string, TransitionPropertyValue> {
	const properties: Record<string, TransitionPropertyValue> = {};
	for (const parameter of definition.parameters ?? []) {
		const value = parameter.defaultValue;
		properties[parameter.key] = typeof value === 'number' ? value : [value[0], value[1], value[2]];
	}
	return properties;
}
