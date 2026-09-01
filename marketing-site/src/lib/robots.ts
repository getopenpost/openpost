export const publicContentSignal =
	'Content-Signal: search=yes, ai-input=yes, ai-train=yes, use=reference';

export function renderPublicRobots() {
	return [
		'# OpenPost permits search, AI input, model training, and attributed reference use of public pages.',
		publicContentSignal,
		'',
		'User-agent: *',
		'Allow: /',
		'',
		'Sitemap: https://openpo.st/sitemap.xml',
		''
	].join('\n');
}
