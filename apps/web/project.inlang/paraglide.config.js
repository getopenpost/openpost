// The single Paraglide option set, shared by `generate:i18n` and the Vite plugin.
// `preferredLanguage` keeps first-visit Accept-Language detection. Production
// Vite builds override the layout with per-message modules; see vite.config.ts.
export default {
	outdir: './src/lib/paraglide',
	strategy: ['cookie', 'globalVariable', 'preferredLanguage', 'baseLocale'],
	outputStructure: 'locale-modules',
	isServer: "import.meta.env?.SSR ?? typeof window === 'undefined'",
	emitTsDeclarations: true
};
