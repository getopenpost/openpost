import prettier from 'eslint-config-prettier';
import path from 'node:path';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off',
			// Allow unused vars (common in Svelte components, catch blocks, destructuring)
			'@typescript-eslint/no-unused-vars': 'off',
			// Allow svelte/no-navigation-without-resolve (goto/ href without resolve() is fine in SvelteKit)
			'svelte/no-navigation-without-resolve': 'off',
			// Allow each blocks without keys for simple lists
			'svelte/require-each-key': 'off',
			// Allow mutable Map instances (SvelteMap not always appropriate)
			'svelte/prefer-svelte-reactivity': 'off',
			// Allow @ts-ignore comments
			'@typescript-eslint/ban-ts-comment': 'off',
			// Allow explicit any where needed
			'@typescript-eslint/no-explicit-any': 'off',
			// Allow unused svelte-ignore comments (newer plugin warns about them)
			'svelte/no-unused-svelte-ignore': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser,
				svelteConfig
			}
		}
	}
);
