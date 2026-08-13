import type { components } from '$lib/api/types';

type SettingDefinition = components['schemas']['SettingDefinition'];
type SettingCondition = components['schemas']['SettingCondition'];

function conditionMatches(condition: SettingCondition, values: Record<string, unknown>): boolean {
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
			return Array.isArray(condition.value) && condition.value.includes(value);
	}
}

export function loadableDestinationOptionSources(
	settings: SettingDefinition[],
	onlySource = ''
): string[] {
	const sources = settings
		.filter((setting) => !setting.unavailable_reason)
		.map((setting) => setting.options_source)
		.filter((source): source is string => Boolean(source));
	const uniqueSources = [...new Set(sources)];

	if (!onlySource) return uniqueSources;
	return uniqueSources.includes(onlySource) ? [onlySource] : [];
}

export function invalidateDependentDestinationSettings(
	settings: SettingDefinition[],
	values: Record<string, unknown>,
	changedKey: string,
	changedValue: unknown
): { values: Record<string, unknown>; optionSources: string[] } {
	const next = { ...values, [changedKey]: changedValue };
	const optionSources = new Set<string>();
	for (const setting of settings) {
		if (!(setting.dependencies ?? []).some((condition) => condition.key === changedKey)) continue;
		if (setting.options_source) optionSources.add(setting.options_source);
		if ((setting.dependencies ?? []).every((condition) => conditionMatches(condition, next)))
			continue;
		delete next[setting.key];
	}
	return { values: next, optionSources: [...optionSources] };
}

export function mergeDestinationOptions(
	current: Array<{ value: string; label: string }>,
	incoming: Array<{ value: string; label: string }>
): Array<{ value: string; label: string }> {
	const merged = new Map(current.map((option) => [option.value, option]));
	for (const option of incoming) merged.set(option.value, option);
	return [...merged.values()];
}
