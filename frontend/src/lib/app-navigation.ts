export type PrimaryNavigationItem = {
	id:
		| 'new'
		| 'calendar'
		| 'posts'
		| 'communications'
		| 'growth'
		| 'analytics'
		| 'media'
		| 'editors'
		| 'accounts'
		| 'settings';
	label: string;
	href: string;
	match: string[];
	mobile: boolean;
};

export const primaryNavigation: PrimaryNavigationItem[] = [
	{ id: 'new', label: 'New post', href: '/', match: ['/'], mobile: true },
	{ id: 'calendar', label: 'Calendar', href: '/calendar', match: ['/calendar'], mobile: true },
	{ id: 'posts', label: 'Posts', href: '/activity', match: ['/activity', '/posts'], mobile: true },
	{
		id: 'communications',
		label: 'Inbox',
		href: '/engagement',
		match: ['/engagement', '/messages'],
		mobile: false
	},
	{
		id: 'growth',
		label: 'Grow',
		href: '/grow',
		match: ['/grow'],
		mobile: false
	},
	{
		id: 'analytics',
		label: 'Analytics',
		href: '/analytics',
		match: ['/analytics'],
		mobile: false
	},
	{ id: 'media', label: 'Media', href: '/media', match: ['/media'], mobile: true },
	{
		id: 'editors',
		label: 'Editors',
		href: '/editors',
		match: ['/editors', '/image-editor', '/video-editor'],
		mobile: false
	},
	{ id: 'settings', label: 'Settings', href: '/settings', match: ['/settings'], mobile: false }
];

const mobileNavigationOrder = ['calendar', 'posts', 'new', 'media'] as const;

export const mobileNavigation = mobileNavigationOrder.map((id) =>
	primaryNavigation.find((item) => item.id === id)!
);

export function isNavigationItemActive(item: PrimaryNavigationItem, pathname: string): boolean {
	return item.match.some((path) =>
		path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`)
	);
}

export function isOrganizationOwnershipSettingsRoute(url: URL): boolean {
	return (
		url.pathname === '/settings' &&
		(url.searchParams.get('tab') === 'ownership' || url.hash === '#ownership')
	);
}
