import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import './custom.css';

const apiReferencePath = '/development/api-reference';

export default {
	extends: DefaultTheme,
	async enhanceApp(ctx) {
		await DefaultTheme.enhanceApp?.(ctx);

		let openapiReady = false;
		const loadOpenapi = async () => {
			if (openapiReady) return;

			const [{ default: openapiSpec }, { theme, useOpenapi }] = await Promise.all([
				import('../../.generated/openapi.json'),
				import('vitepress-openapi/client'),
				import('vitepress-openapi/dist/style.css'),
			]);

			useOpenapi({
				spec: openapiSpec,
				config: {
					spec: {
						groupByTags: true,
						showPathsSummary: true,
					},
				},
			});
			await theme.enhanceApp(ctx);
			openapiReady = true;
		};

		if (ctx.router.route.path === apiReferencePath) {
			await loadOpenapi();
		}

		const previousRouteGuard = ctx.router.onBeforeRouteChange;
		ctx.router.onBeforeRouteChange = async (to) => {
			const result = await previousRouteGuard?.(to);
			if (result === false) return false;
			if (to.split(/[?#]/, 1)[0] === apiReferencePath) await loadOpenapi();
		};
	},
} satisfies Theme;
