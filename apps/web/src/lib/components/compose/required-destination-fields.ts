import type { components } from '$lib/api/types';
import type { ComposerSettings } from '$lib/components/compose/modes';

type SettingDefinition = components['schemas']['SettingDefinition'];
type SettingCondition = components['schemas']['SettingCondition'];
type ResolvedAccountCapability = components['schemas']['ResolvedAccountCapability'];

export interface RequiredDestinationField {
	accountId: string;
	setting: SettingDefinition;
}

function conditionMatches(condition: SettingCondition, values: ComposerSettings): boolean {
	const value = values[condition.key];
	const present = value !== undefined && value !== null && String(value).trim() !== '';
	switch (condition.operator) {
		case 'present':
			return present;
		case 'absent':
			return !present;
		case 'equals':
			return present && String(value) === String(condition.value);
		case 'not_equals':
			return !present || String(value) !== String(condition.value);
		case 'in':
			return Array.isArray(condition.value) && condition.value.map(String).includes(String(value));
	}
}

export function activeRequiredDestinationFields(
	accountIds: string[],
	resolvedByAccount: Record<string, ResolvedAccountCapability>,
	valuesByAccount: Record<string, ComposerSettings>
): RequiredDestinationField[] {
	return accountIds.flatMap((accountId) => {
		const capability = resolvedByAccount[accountId];
		const values = valuesByAccount[accountId] ?? {};
		const seen = new Set<string>();
		return (capability?.setting_groups ?? []).flatMap((group) =>
			(group.settings ?? [])
				.filter((setting) => {
					if (!setting.required || setting.scope === 'media_item' || seen.has(setting.key))
						return false;
					if (
						!(setting.dependencies ?? []).every((condition) => conditionMatches(condition, values))
					) {
						return false;
					}
					seen.add(setting.key);
					return true;
				})
				.map((setting) => ({ accountId, setting }))
		);
	});
}

export function requiredFieldIsMissing(
	setting: SettingDefinition,
	values: ComposerSettings
): boolean {
	const value = values[setting.key];
	if (setting.type === 'boolean') return value !== true;
	return value === undefined || value === null || String(value).trim() === '';
}
