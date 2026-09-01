import type { components } from '$lib/api/types';

type SettingDefinition = components['schemas']['SettingDefinition'];
type SettingCondition = components['schemas']['SettingCondition'];
type DestinationSettings = NonNullable<components['schemas']['RenditionInput']['settings']>;
type DestinationSettingValue = SettingDefinition['default'];

export interface DestinationOption {
	value: string;
	label: string;
}

export interface DestinationSettingInvalidation {
	values: DestinationSettings;
	optionSources: string[];
}

function conditionMatches(condition: SettingCondition, values: DestinationSettings): boolean {
	const value = values[condition.key];
	const present = value !== undefined && value !== null && String(value).trim() !== '';
	switch (condition.operator) {
		case 'present':
			return present;
		case 'absent':
			return !present;
		case 'equals':
			return value === condition.value;
		case 'not_equals':
			return value !== condition.value;
		case 'in':
			return Array.isArray(condition.value) && condition.value.some((item) => item === value);
	}
}

export function loadableDestinationOptionSources(
	settings: SettingDefinition[],
	onlySource = '',
	values: DestinationSettings = {}
): string[] {
	const sources = settings
		.filter(
			(setting) =>
				!setting.unavailable_reason &&
				(setting.dependencies ?? []).every((condition) => conditionMatches(condition, values))
		)
		.map((setting) => setting.options_source)
		.filter((source): source is string => Boolean(source));
	const uniqueSources = [...new Set(sources)];

	if (!onlySource) return uniqueSources;
	return uniqueSources.includes(onlySource) ? [onlySource] : [];
}

export function invalidateDependentDestinationSettings(
	settings: SettingDefinition[],
	values: DestinationSettings,
	changedKey: string,
	changedValue: DestinationSettingValue
): DestinationSettingInvalidation {
	const next = { ...values, [changedKey]: changedValue };
	const optionSources = new Set<string>();
	for (const setting of settings) {
		if (!(setting.dependencies ?? []).some((condition) => condition.key === changedKey)) continue;
		if (setting.options_source) optionSources.add(setting.options_source);
		// A provider-owned child value is bound to the exact parent collection.
		// Clear it even when the new parent still satisfies a `present` dependency.
		delete next[setting.key];
	}
	return { values: next, optionSources: [...optionSources] };
}

export function mergeDestinationOptions(
	current: DestinationOption[],
	incoming: DestinationOption[]
): DestinationOption[] {
	const merged = new Map(current.map((option) => [option.value, option]));
	for (const option of incoming) merged.set(option.value, option);
	return [...merged.values()];
}
