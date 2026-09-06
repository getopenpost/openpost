import type {
	ResolvedTheme,
	ThemeFamilyId,
	ThemeManifest,
	ThemeScheme,
	ThemeSchemeManifest
} from './contracts.js';
import { workshopTheme } from './builtins/workshop.js';
import { studioTheme } from './builtins/studio.js';
import { notebookTheme } from './builtins/notebook.js';
import { playroomTheme } from './builtins/playroom.js';
import { cloudGardenTheme } from './builtins/cloud-garden.js';
import { studyHallTheme } from './builtins/study-hall.js';
import { corkboardTheme } from './builtins/corkboard.js';
import { midnightTheme } from './builtins/midnight.js';
import { ferrariTheme } from './builtins/ferrari.js';
import { appleTheme } from './builtins/apple.js';
import { todoistTheme } from './builtins/todoist.js';
import { notionTheme } from './builtins/notion.js';
import { supabaseTheme } from './builtins/supabase.js';
import { vercelTheme } from './builtins/vercel.js';
import { firecrawlTheme } from './builtins/firecrawl.js';
import { linearTheme } from './builtins/linear.js';
import { calcomTheme } from './builtins/calcom.js';
import { mintlifyTheme } from './builtins/mintlify.js';
import { launchdarklyTheme } from './builtins/launchdarkly.js';
import { posthogTheme } from './builtins/posthog.js';
import { originTheme } from './builtins/origin.js';
import { columnTheme } from './builtins/column.js';
import { duolingoTheme } from './builtins/duolingo.js';
import { quizletTheme } from './builtins/quizlet.js';

export const WORKSHOP_FALLBACK_THEME: ThemeManifest = workshopTheme;

export const BUILT_IN_THEMES: readonly ThemeManifest[] = [
	WORKSHOP_FALLBACK_THEME,
	studioTheme,
	notebookTheme,
	playroomTheme,
	cloudGardenTheme,
	studyHallTheme,
	corkboardTheme,
	midnightTheme,
	ferrariTheme,
	appleTheme,
	todoistTheme,
	notionTheme,
	supabaseTheme,
	vercelTheme,
	firecrawlTheme,
	linearTheme,
	calcomTheme,
	mintlifyTheme,
	launchdarklyTheme,
	posthogTheme,
	originTheme,
	columnTheme,
	duolingoTheme,
	quizletTheme
];

const builtInThemesById = new Map(BUILT_IN_THEMES.map((item) => [item.id, item]));

function cloneScheme(value: ThemeSchemeManifest): ThemeSchemeManifest {
	return structuredClone(value);
}

export function getBuiltInTheme(id: ThemeFamilyId): ThemeManifest {
	const value = builtInThemesById.get(id);
	if (!value) throw new Error(`Unknown built-in theme: ${id}`);
	return value;
}

// Static client mirror of the server built-in resolution rule (unsupported
// scheme falls back as a whole to Workshop, never a hybrid). Used for
// offline-capable preview and unavailable-theme placeholders; authoritative
// resolution always goes through the server resolver.
export function resolveBuiltInTheme(
	id: ThemeFamilyId | string,
	requestedScheme: ThemeScheme
): ResolvedTheme {
	const requested = builtInThemesById.get(id);
	const selected = requested?.schemes[requestedScheme];

	if (requested && selected) {
		return {
			id: requested.id,
			revision: requested.revision,
			name: requested.name,
			iconPack: requested.iconPack,
			source: 'builtin',
			requestedScheme,
			scheme: requestedScheme,
			manifest: cloneScheme(selected),
			fonts: [],
			assets: structuredClone(requested.assets)
		};
	}

	return {
		id: WORKSHOP_FALLBACK_THEME.id,
		revision: WORKSHOP_FALLBACK_THEME.revision,
		name: WORKSHOP_FALLBACK_THEME.name,
		iconPack: WORKSHOP_FALLBACK_THEME.iconPack,
		source: 'fallback',
		requestedScheme,
		scheme: requestedScheme,
		manifest: cloneScheme(WORKSHOP_FALLBACK_THEME.schemes[requestedScheme]!),
		fonts: [],
		assets: [],
		fallbackReason: requested ? 'unsupported-scheme' : 'missing-theme'
	};
}
