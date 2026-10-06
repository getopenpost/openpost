export const publicContentSignal = 'Content-Signal: search=yes, ai-input=yes, ai-train=yes';

export function renderPublicRobots() {
	return [
		'# OpenPost permits search, AI input, and model training for public pages.',
		'User-agent: *',
		publicContentSignal,
		'Allow: /',
		'',
		'Sitemap: https://openpo.st/sitemap.xml',
		'Sitemap: https://openpo.st/docs/sitemap.xml',
		'# Agent Markdown indexes: https://openpo.st/sitemap.md and https://openpo.st/docs/sitemap.md',
		''
	].join('\n');
}
