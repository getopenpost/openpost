import { defineConfig } from 'vitepress';

// Default to root-path hosting so custom-domain deployments work without extra config.
// Repository-path deployments (for example, GitHub Pages at /openpost/) should set OPENPOST_DOCS_BASE explicitly.
const docsBase = process.env.OPENPOST_DOCS_BASE?.trim() || '/';

const userDocsSidebar = [
	{
		text: 'Start Here',
		collapsed: false,
		items: [
			{ text: 'What is OpenPost?', link: '/guide/what-is-openpost' },
			{ text: 'Quickstart', link: '/guide/quickstart' },
			{ text: 'Concepts', link: '/guide/concepts' },
		],
	},
	{
		text: 'Web App',
		collapsed: false,
		items: [
			{ text: 'Overview', link: '/usage/' },
			{ text: 'Agent-Assisted Publishing', link: '/usage/agent-assisted-publishing' },
			{ text: 'Workspaces', link: '/usage/workspaces' },
			{ text: 'Settings', link: '/usage/settings' },
			{ text: 'Accounts', link: '/usage/accounts' },
			{ text: 'Composing Posts', link: '/usage/composing-posts' },
			{ text: 'Destination Options', link: '/usage/destination-options' },
			{ text: 'Threads', link: '/usage/threads' },
			{ text: 'Scheduling', link: '/usage/scheduling' },
			{ text: 'Analytics', link: '/usage/analytics' },
			{ text: 'Media Library', link: '/usage/media-library' },
			{ text: 'OpenPost Studio', link: '/usage/studio' },
		],
	},
	{
		text: 'CLI',
		collapsed: false,
		items: [
			{ text: 'Overview', link: '/cli/' },
			{ text: 'Installation', link: '/cli/installation' },
			{ text: 'Authentication', link: '/cli/authentication' },
			{ text: 'Posting', link: '/cli/posting' },
			{ text: 'Automation', link: '/cli/automation' },
		],
	},
	{
		text: 'MCP',
		collapsed: false,
		items: [{ text: 'Assistant Scheduling', link: '/mcp/' }],
	},
	{
		text: 'Apps',
		collapsed: false,
		items: [{ text: 'Android App', link: '/installation/android' }],
	},
	{
		text: 'Reference',
		collapsed: false,
		items: [
			{ text: 'CLI Command Reference', link: '/reference/cli' },
			{ text: 'Product Surface Parity', link: '/reference/surface-parity' },
		],
	},
];

const selfHostingSidebar = [
	{
		text: 'Overview',
		collapsed: false,
		items: [{ text: 'Start Here', link: '/self-hosting/' }],
	},
	{
		text: 'Install',
		collapsed: false,
		items: [
			{ text: 'Why Self-Host?', link: '/guide/why-selfhost' },
			{ text: 'Docker Compose', link: '/installation/docker-compose' },
			{ text: 'Single Binary', link: '/installation/binary' },
			{ text: 'Nix Module', link: '/installation/nix-module' },
			{ text: 'Reverse Proxy', link: '/installation/reverse-proxy' },
			{ text: 'Build From Source', link: '/installation/build-from-source' },
			{ text: 'Docker Run', link: '/installation/docker-run' },
		],
	},
	{
		text: 'Configure',
		collapsed: false,
		items: [
			{ text: 'Overview', link: '/configuration/overview' },
			{ text: 'Environment Variables', link: '/configuration/environment-variables' },
			{ text: 'Update Status', link: '/configuration/update-status' },
			{ text: 'User Feedback', link: '/configuration/feedback' },
			{ text: 'Database', link: '/configuration/database' },
			{ text: 'Media Storage', link: '/configuration/media-storage' },
			{ text: 'CORS and URLs', link: '/configuration/cors-and-urls' },
			{ text: 'Production Checklist', link: '/configuration/production-checklist' },
		],
	},
	{
		text: 'Providers',
		collapsed: false,
		items: [
			{ text: 'Overview', link: '/providers/overview' },
			{ text: 'Launch Verification Matrix', link: '/providers/launch-matrix' },
			{ text: 'Supported Platforms & Limits', link: '/providers/platform-limits' },
			{ text: 'Provider Troubleshooting', link: '/providers/troubleshooting' },
			{ text: 'Provider Roadmap', link: '/providers/roadmap' },
			{ text: 'X', link: '/providers/x' },
			{ text: 'Mastodon', link: '/providers/mastodon' },
			{ text: 'Bluesky', link: '/providers/bluesky' },
			{ text: 'LinkedIn', link: '/providers/linkedin' },
			{ text: 'Threads', link: '/providers/threads' },
			{ text: 'Facebook', link: '/providers/facebook' },
			{ text: 'Instagram', link: '/providers/instagram' },
			{ text: 'TikTok', link: '/providers/tiktok' },
			{ text: 'YouTube', link: '/providers/youtube' },
			{ text: 'Discord Webhooks', link: '/providers/discord' },
			{ text: 'Engagement, Inbox & Notifications', link: '/usage/communications' },
		],
	},
	{
		text: 'Operate',
		collapsed: false,
		items: [
			{ text: 'Backups', link: '/operations/backups' },
			{ text: 'Health Checks', link: '/operations/health-checks' },
			{ text: 'Logs', link: '/operations/logs' },
			{ text: 'Upgrades', link: '/operations/upgrades' },
			{ text: 'Troubleshooting', link: '/operations/troubleshooting' },
		],
	},
	{
		text: 'Reference',
		collapsed: false,
		items: [
			{ text: 'API', link: '/reference/api' },
			{ text: 'Environment Variables', link: '/reference/env-vars' },
			{ text: 'Callback URLs', link: '/reference/callback-urls' },
			{ text: 'Docker Compose', link: '/reference/docker-compose' },
		],
	},
];

const developmentSidebar = [
	{
		text: 'Development',
		collapsed: false,
		items: [
			{ text: 'Overview', link: '/development/' },
			{ text: 'Setup', link: '/development/setup' },
			{ text: 'Architecture', link: '/development/architecture' },
			{ text: 'API Reference', link: '/development/api-reference' },
			{ text: 'Frontend', link: '/development/frontend' },
			{ text: 'Backend', link: '/development/backend' },
			{ text: 'Platform Adapters', link: '/development/platform-adapters' },
			{ text: 'Background Jobs', link: '/development/background-jobs' },
			{ text: 'Analytics Architecture', link: '/development/analytics' },
			{ text: 'Testing', link: '/development/testing' },
			{ text: 'Releases and Versioning', link: '/development/releases' },
			{ text: 'MCP And ChatGPT App', link: '/development/mcp' },
			{ text: 'Billing And Usage', link: '/development/billing-and-usage' },
			{ text: 'Production Architecture', link: '/development/production-readiness' },
			{ text: 'Third-Party Notices', link: '/development/third-party-notices' },
			{ text: 'Contributing', link: '/development/contributing' },
		],
	},
];

export default defineConfig({
	title: 'OpenPost',
	description: 'Draft, adapt, schedule, and automate social posts with the managed OpenPost app or the same self-hosted product.',
	base: docsBase,
	cleanUrls: true,
	lastUpdated: true,
	head: [
		['link', { rel: 'icon', href: `${docsBase}assets/brand/icon.svg` }],
		['meta', { property: 'og:type', content: 'website' }],
		['meta', { property: 'og:title', content: 'OpenPost' }],
		['meta', { property: 'og:description', content: 'Draft, adapt, schedule, and automate social posts with the managed OpenPost app or the same self-hosted product.' }],
		['meta', { property: 'og:image', content: `${docsBase}assets/brand/og-image.png` }],
	],
	themeConfig: {
		logo: '/assets/brand/icon.svg',
		nav: [
			{ text: 'Home', link: 'https://openpost.social' },
			{ text: 'User Docs', link: '/usage/' },
			{ text: 'CLI', link: '/cli/' },
			{ text: 'MCP', link: '/mcp/' },
			{ text: 'Self-Hosting', link: '/self-hosting/' },
			{ text: 'Providers', link: '/providers/overview' },
			{ text: 'Developer Docs', link: '/development/' },
		],
		socialLinks: [{ icon: 'github', link: 'https://github.com/rodrgds/openpost' }],
		search: {
			provider: 'local',
		},
		editLink: {
			pattern: 'https://github.com/rodrgds/openpost/edit/main/docs-site/:path',
			text: 'Edit this page on GitHub',
		},
		footer: {
			message: 'Open source under AGPL-3.0-only.',
			copyright: 'Copyright © 2026 OpenPost Contributors',
		},
		sidebar: {
			'/installation/android': userDocsSidebar,
			'/reference/cli': userDocsSidebar,
			'/guide/what-is-openpost': userDocsSidebar,
			'/guide/quickstart': userDocsSidebar,
			'/guide/concepts': userDocsSidebar,
			'/usage/': userDocsSidebar,
			'/cli/': userDocsSidebar,
			'/mcp/': userDocsSidebar,
			'/guide/why-selfhost': selfHostingSidebar,
			'/self-hosting/': selfHostingSidebar,
			'/installation/': selfHostingSidebar,
			'/configuration/': selfHostingSidebar,
			'/providers/': selfHostingSidebar,
			'/operations/': selfHostingSidebar,
			'/reference/': selfHostingSidebar,
			'/development/': developmentSidebar,
			'/': userDocsSidebar,
		},
	},
});
