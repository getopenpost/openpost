import {
	BUNDLED_THEME_FONTS,
	BUNDLED_THEME_FONT_IDS,
	type BundledThemeFont
} from './bundled-fonts.js';
import {
	THEME_TYPOGRAPHY_ROLE_KEYS,
	type ThemeFontFace,
	type WebResolvedTheme
} from './contracts.js';

export interface ThemeFontPlanEntry {
	kind: 'bundled' | 'uploaded';
	sourceFamily: string;
	runtimeFamily: string;
	weight: number;
	style: 'normal' | 'italic';
	display: 'swap' | 'fallback' | 'optional';
	sourceUrl?: string;
}

export interface ThemeFontPlan {
	entries: readonly ThemeFontPlanEntry[];
	familyNames: ReadonlyMap<string, string>;
}

export interface ThemeFontStage {
	release(): void;
}

export interface ThemeFontFaceHandle {
	load(): Promise<void>;
}

export interface ThemeFontEnvironment {
	loadBundled(entry: ThemeFontPlanEntry): Promise<boolean>;
	createUploaded(entry: ThemeFontPlanEntry): ThemeFontFaceHandle;
	add(face: ThemeFontFaceHandle): void;
	delete(face: ThemeFontFaceHandle): void;
}

const bundledByFamily = new Map<string, BundledThemeFont>(
	BUNDLED_THEME_FONT_IDS.map((id) => {
		const font = BUNDLED_THEME_FONTS[id];
		return [font.family, font];
	})
);

function uploadedRuntimeFamily(theme: WebResolvedTheme, family: string): string {
	return `OpenPost Theme ${theme.source}:${theme.id}:${theme.revision}:${family}`;
}

function matchingUploadedFace(
	fonts: readonly ThemeFontFace[],
	family: string,
	weight: number
): ThemeFontFace | undefined {
	const matching = fonts.filter(
		(font) => font.family === family && font.weight === weight && font.style === 'normal'
	);
	if (matching.length !== 1) return undefined;
	return matching[0];
}

export function createThemeFontPlan(theme: WebResolvedTheme): ThemeFontPlan | null {
	const familyNames = new Map<string, string>();
	const entries = new Map<string, ThemeFontPlanEntry>();

	for (const role of THEME_TYPOGRAPHY_ROLE_KEYS) {
		const tokens = theme.manifest.typography[role];
		const bundled = bundledByFamily.get(tokens.family);
		if (bundled) {
			if (!bundled.weights.includes(tokens.weight)) return null;
			familyNames.set(tokens.family, tokens.family);
			const key = `bundled\0${tokens.family}\0${tokens.weight}\0normal`;
			entries.set(key, {
				kind: 'bundled',
				sourceFamily: tokens.family,
				runtimeFamily: tokens.family,
				weight: tokens.weight,
				style: 'normal',
				display: 'swap'
			});
			continue;
		}

		const face = matchingUploadedFace(theme.fonts, tokens.family, tokens.weight);
		if (!face) return null;
		const runtimeFamily = uploadedRuntimeFamily(theme, tokens.family);
		familyNames.set(tokens.family, runtimeFamily);
		const key = `uploaded\0${tokens.family}\0${tokens.weight}\0${face.style}`;
		entries.set(key, {
			kind: 'uploaded',
			sourceFamily: tokens.family,
			runtimeFamily,
			weight: face.weight,
			style: face.style,
			display: face.display,
			sourceUrl: face.sourceUrl
		});
	}

	return { entries: [...entries.values()], familyNames };
}

function cssFontName(name: string): string {
	return JSON.stringify(name);
}

export function themeFontEnvironmentForDocument(
	targetDocument: Document,
	FontFaceConstructor = targetDocument.defaultView?.FontFace
): ThemeFontEnvironment | null {
	if (!FontFaceConstructor) return null;
	const handles = new WeakMap<ThemeFontFaceHandle, FontFace>();
	return {
		async loadBundled(entry) {
			const faces = await targetDocument.fonts.load(
				`${entry.style} ${entry.weight} 1em ${cssFontName(entry.runtimeFamily)}`
			);
			return faces.length > 0;
		},
		createUploaded(entry) {
			if (!entry.sourceUrl) throw new Error('Uploaded theme font is missing its web source');
			const face = new FontFaceConstructor(
				entry.runtimeFamily,
				`url(${JSON.stringify(entry.sourceUrl)})`,
				{
					weight: `${entry.weight}`,
					style: entry.style,
					display: entry.display
				}
			);
			const handle: ThemeFontFaceHandle = {
				load: async () => {
					await face.load();
				}
			};
			handles.set(handle, face);
			return handle;
		},
		add(handle) {
			const face = handles.get(handle);
			if (!face) throw new Error('Unknown staged theme font');
			targetDocument.fonts.add(face);
		},
		delete(handle) {
			const face = handles.get(handle);
			if (face) targetDocument.fonts.delete(face);
		}
	};
}

function browserFontEnvironment(): ThemeFontEnvironment | null {
	if (!('document' in globalThis)) return null;
	return themeFontEnvironmentForDocument(globalThis.document);
}

export async function stageThemeFontPlan(
	plan: ThemeFontPlan,
	environment = browserFontEnvironment()
): Promise<ThemeFontStage> {
	if (!environment) {
		return { release: () => undefined };
	}

	const uploaded = plan.entries
		.filter((entry) => entry.kind === 'uploaded')
		.map((entry) => environment.createUploaded(entry));
	const bundled = plan.entries.filter((entry) => entry.kind === 'bundled');
	await Promise.all([
		...uploaded.map((face) => face.load()),
		...bundled.map(async (entry) => {
			if (!(await environment.loadBundled(entry))) {
				throw new Error(`Bundled theme font is unavailable: ${entry.sourceFamily}`);
			}
		})
	]);

	const added: ThemeFontFaceHandle[] = [];
	try {
		for (const face of uploaded) {
			environment.add(face);
			added.push(face);
		}
	} catch (error) {
		for (const face of added) environment.delete(face);
		throw error;
	}

	let released = false;
	return {
		release() {
			if (released) return;
			released = true;
			for (const face of added) environment.delete(face);
		}
	};
}
