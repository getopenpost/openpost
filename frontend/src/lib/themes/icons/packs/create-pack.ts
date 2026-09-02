import type { IconifyJSON } from '@iconify/types';
import { getIconData } from '@iconify/utils/lib/icon-set/get-icon';
import { iconToSVG } from '@iconify/utils/lib/svg/build';
import { THEME_ICON_ROLES, type ThemeIconPackId, type ThemeIconRole } from '../../contracts.js';
import type { ThemeIconPack } from '../types.js';

export function createThemeIconPack(
	id: ThemeIconPackId,
	collection: IconifyJSON,
	names: Record<ThemeIconRole, string>
): ThemeIconPack {
	// SAFETY: THEME_ICON_ROLES is exhaustive, and each mapped tuple uses its current role as the key.
	const icons = Object.fromEntries(
		THEME_ICON_ROLES.map((role) => {
			const icon = getIconData(collection, names[role]);
			if (!icon) throw new Error(`${id} is missing the ${role} theme icon`);
			const rendered = iconToSVG(icon, { height: '1em', width: '1em' });
			return [role, { body: rendered.body, viewBox: rendered.attributes.viewBox }];
		})
	) as ThemeIconPack['icons'];
	return { id, icons };
}
