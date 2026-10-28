import path from 'node:path';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isFileLoadingAllowed, normalizePath } from 'vite';

/**
 * @param {string} root
 * @returns {{ plugin: import('vite').Plugin, reporter: import('vitest/reporters').Reporter }}
 */
export function paraglideTestMaps(root) {
	let eligible = false;
	/** @type {string | undefined} */
	let directory;
	const browserConfigs = new WeakSet();

	return {
		reporter: {
			onInit(vitest) {
				eligible =
					'run' in vitest.config &&
					vitest.config.run === true &&
					vitest.config.watch === false &&
					vitest.config.coverage.enabled === false;
			}
		},
		plugin: {
			name: 'openpost-browser-paraglide-test-maps',
			apply: 'serve',
			enforce: 'post',
			applyToEnvironment(environment) {
				return environment.config.consumer === 'client' && !environment.config.isBundled;
			},
			async configResolved(config) {
				if (!config.plugins.some((plugin) => plugin.name === 'vitest:browser:tests')) return;
				directory = path.join(await realpath(root), 'apps/web/src/lib/paraglide');
				browserConfigs.add(config);
			},
			load: {
				order: 'post',
				async handler(id, options) {
					if (!eligible) return null;
					const config = this.environment.getTopLevelConfig();
					if (
						!directory ||
						!browserConfigs.has(config) ||
						options?.ssr ||
						this.environment.config.consumer !== 'client' ||
						!path.isAbsolute(id) ||
						/[?#\0]/.test(id) ||
						!id.endsWith('.js')
					)
						return null;

					const file = path.resolve(id);
					const relative = path.relative(directory, file);
					if (
						!relative ||
						relative === '..' ||
						relative.startsWith('..' + path.sep) ||
						path.isAbsolute(relative) ||
						!isFileLoadingAllowed(config, normalizePath(file))
					)
						return null;

					try {
						if (
							normalizePath(await realpath(file)) !== normalizePath(file) ||
							!(await lstat(file)).isFile()
						)
							return null;
						const code = await readFile(file, 'utf8');
						this.addWatchFile(file);
						// Vite discards map-only transforms of unchanged leaf code. Seed
						// the map at load so it survives that path and later import rewrites.
						return { code, map: { mappings: '' } };
					} catch (error) {
						if (
							error instanceof Error &&
							'code' in error &&
							(error.code === 'ENOENT' || error.code === 'EISDIR')
						)
							return null;
						throw error;
					}
				}
			}
		}
	};
}
