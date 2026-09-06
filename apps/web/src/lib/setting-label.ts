import type { components } from '$lib/api/types';
import { m } from '$lib/paraglide/messages';

type SettingDefinition = components['schemas']['SettingDefinition'];
type MessageFunction = () => string;

function asGeneratedMessageRegistry<Module extends object>(module: Module) {
	// SAFETY: Paraglide generates callable exports. Destination setting message keys identify the
	// zero-input publishing-setting subset, but arrive as server metadata rather than static keys.
	return module as Module & Record<string, MessageFunction | undefined>;
}

const messageRegistry = asGeneratedMessageRegistry(m);

export function settingLabel(setting: SettingDefinition): string {
	const messageKey = setting.message_key.replaceAll('.', '_');
	return messageRegistry[messageKey]?.() ?? setting.label;
}
