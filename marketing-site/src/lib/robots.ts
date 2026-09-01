export const publicContentSignal = 'Content-Signal: search=yes, ai-input=yes, ai-train=yes';

export function renderPublicRobots() {
	return [
		'# OpenPost permits search, AI input, and model training for public pages.',
		'User-agent: *',
		publicContentSignal,
		'Allow: /',
		'',
		'Sitemap: https://openpo.st/sitemap.xml',
		''
	].join('\n');
}
