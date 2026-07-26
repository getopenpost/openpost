import type { components } from '$lib/api/types';

type SettingDefinition = components['schemas']['SettingDefinition'];

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
