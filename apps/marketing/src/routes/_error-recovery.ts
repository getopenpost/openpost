export const marketingErrorRecovery = {
	status: 404,
	label: 'Page not found',
	title: 'We couldn’t find that page.',
	description: 'The link may be old or the address mistyped. Try one of these instead.',
	primary: { label: 'Go to OpenPost home', href: '/' },
	routes: [
		{
			label: 'Explore features',
			description: 'Find the tools for your next post.',
			href: '/#features'
		},
		{
			label: 'Read the FAQ',
			description: 'Answers about posts, plans, and your account.',
			href: '/faq'
		},
		{
			label: 'Open the help centre',
			description: 'Get help with OpenPost.',
			href: 'https://docs.openpo.st/guides/quickstart'
		}
	],
	support: [
		{ label: 'Email support', href: 'mailto:openpost@rgo.pt' },
		{
			label: 'Ask the Discord community',
			href: 'https://discord.com/invite/u2QwukmY4W'
		}
	]
} as const;
