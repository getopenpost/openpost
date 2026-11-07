// The single Paraglide option set, shared by `generate:i18n` and the Vite plugin.
// `preferredLanguage` keeps first-visit Accept-Language detection. Message
// modules tree-shake per message and declare every message in one file.
export default {
	outdir: './src/lib/paraglide',
	strategy: ['cookie', 'globalVariable', 'preferredLanguage', 'baseLocale'],
	outputStructure: 'message-modules',
	isServer: "import.meta.env?.SSR ?? typeof window === 'undefined'",
	emitTsDeclarations: true
};
