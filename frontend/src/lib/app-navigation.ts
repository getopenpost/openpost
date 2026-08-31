export type PrimaryNavigationItem = {
	id:
		| 'new'
		| 'calendar'
		| 'publications'
		| 'communications'
		| 'growth'
		| 'analytics'
		| 'media'
		| 'editors'
		| 'settings';
	label: string;
	href: string;
	family: AppRouteFamily;
	mobile: boolean;
};

export type AppRouteFamily =
	| 'root'
	| 'calendar'
	| 'publications'
	| 'communications'
	| 'growth'
	| 'analytics'
	| 'media'
	| 'editors'
	| 'settings'
	| 'local-editors';

export const appRouteFamilies = {
	root: ['/'],
	calendar: ['/calendar'],
	publications: ['/publications'],
	communications: ['/inbox'],
	growth: ['/grow'],
	analytics: ['/analytics'],
	media: ['/media'],
	editors: ['/editors', '/image-editor', '/video-editor'],
	settings: ['/settings'],
	'local-editors': ['/video-editor', '/quick-cut', '/record']
} satisfies Record<AppRouteFamily, readonly string[]>;

export const primaryNavigation: PrimaryNavigationItem[] = [
	{ id: 'new', label: 'New post', href: '/', family: 'root', mobile: true },
	{ id: 'calendar', label: 'Calendar', href: '/calendar', family: 'calendar', mobile: true },
	{
		id: 'publications',
		label: 'Publications',
		href: '/publications',
		family: 'publications',
		mobile: true
	},
	{
		id: 'communications',
		label: 'Inbox',
		href: '/inbox/engagement',
		family: 'communications',
		mobile: false
	},
	{
		id: 'growth',
		label: 'Grow',
		href: '/grow',
		family: 'growth',
		mobile: false
	},
	{
		id: 'analytics',
		label: 'Analytics',
		href: '/analytics',
		family: 'analytics',
		mobile: false
	},
	{ id: 'media', label: 'Media', href: '/media', family: 'media', mobile: true },
	{
		id: 'editors',
		label: 'Editors',
		href: '/editors',
		family: 'editors',
		mobile: false
	},
	{ id: 'settings', label: 'Settings', href: '/settings', family: 'settings', mobile: false }
];

const mobileNavigationOrder = ['calendar', 'publications', 'new', 'media'] as const;

export const mobileNavigation = mobileNavigationOrder.map((id) =>
	primaryNavigation.find((item) => item.id === id)!
);

export function isNavigationItemActive(item: PrimaryNavigationItem, pathname: string): boolean {
	return isAppRouteInFamily(pathname, item.family);
}

export function isAppRouteInFamily(pathname: string, family: AppRouteFamily): boolean {
	return appRouteFamilies[family].some((path) =>
		path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`)
	);
}

export function isLocalEditorRoute(pathname: string): boolean {
	return isAppRouteInFamily(pathname, 'local-editors');
}

export function isMoreNavigationRoute(pathname: string): boolean {
	return (
		isAppRouteInFamily(pathname, 'growth') ||
		isAppRouteInFamily(pathname, 'analytics') ||
		isAppRouteInFamily(pathname, 'communications') ||
		isAppRouteInFamily(pathname, 'editors') ||
		isAppRouteInFamily(pathname, 'settings') ||
		isLocalEditorRoute(pathname)
	);
}

export function isOrganizationOwnershipSettingsRoute(url: URL): boolean {
	return (
		url.pathname === '/settings' &&
		(url.searchParams.get('tab') === 'ownership' || url.hash === '#ownership')
	);
}
