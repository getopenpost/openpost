import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		files: {
			assets: process.env.OPENPOST_BUILD_PUBLIC_DIR || 'static'
		},
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html',
			// Text assets are selectively precompressed after the Vite build.
			// Adapter-wide compression would also duplicate the large image-editor model files.
			precompress: false,
			strict: true
		})
	},
	vitePlugin: {
		dynamicCompileOptions: ({ filename }) =>
			filename.includes('node_modules') ? undefined : { runes: true }
	}
};

export default config;
