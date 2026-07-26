export type PrimaryNavigationItem = {
	id: 'new' | 'calendar' | 'posts' | 'media' | 'accounts' | 'settings';
	label: string;
	href: string;
	match: string[];
	mobile: boolean;
};

export const primaryNavigation: PrimaryNavigationItem[] = [
	{ id: 'new', label: 'New post', href: '/', match: ['/'], mobile: true },
	{ id: 'calendar', label: 'Calendar', href: '/calendar', match: ['/calendar'], mobile: true },
	{ id: 'posts', label: 'Posts', href: '/activity', match: ['/activity', '/posts'], mobile: true },
	{ id: 'media', label: 'Media', href: '/media', match: ['/media'], mobile: true },
	{
		id: 'accounts',
		label: 'Social accounts',
		href: '/accounts',
		match: ['/accounts'],
		mobile: true
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
