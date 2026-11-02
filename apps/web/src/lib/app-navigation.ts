export type PrimaryNavigationItem = {
	id:
		| 'home'
		| 'new'
		| 'publications'
		| 'communications'
		| 'analytics'
		| 'ideate'
		| 'studio'
		| 'media'
		| 'workflows'
		| 'accounts'
		| 'settings';
	label: string;
	href: string;
	family: AppRouteFamily;
	mobile: boolean;
};

export type AppRouteFamily =
	| 'ideate'
	| 'home'
	| 'root'
	| 'publications'
	| 'communications'
	| 'growth'
	| 'analytics'
	| 'media'
	| 'studio'
	| 'workflows'
	| 'accounts'
	| 'settings'
	| 'local-editors';

export const appRouteFamilies = {
	home: ['/home'],
	root: ['/'],
	publications: ['/publications', '/calendar'],
	communications: ['/inbox', '/grow'],
	growth: ['/grow'],
	ideate: ['/ideate'],
	workflows: ['/workflows'],
	analytics: ['/analytics'],
	media: ['/media'],
	studio: [
		'/studio',
		'/image-editor',
		'/video-editor',
		'/quick-cut',
		'/record',
		'/templates',
		'/prompts',
		'/voice-profiles'
	],
	accounts: ['/accounts'],
	settings: ['/settings'],
	'local-editors': ['/video-editor', '/quick-cut', '/record']
} satisfies Record<AppRouteFamily, readonly string[]>;

export const primaryNavigation: PrimaryNavigationItem[] = [
	{ id: 'home', label: 'Home', href: '/home', family: 'home', mobile: true },
	{ id: 'new', label: 'New post', href: '/', family: 'root', mobile: true },
	{
		id: 'publications',
		label: 'Posts',
		href: '/publications',
		family: 'publications',
		mobile: true
	},
	{
		id: 'communications',
		label: 'Inbox',
		href: '/inbox/engagement',
		family: 'communications',
		mobile: true
	},
	{ id: 'analytics', label: 'Analytics', href: '/analytics', family: 'analytics', mobile: false },
	{ id: 'ideate', label: 'Ideas', href: '/ideate', family: 'ideate', mobile: false },
	{ id: 'studio', label: 'Studio', href: '/studio', family: 'studio', mobile: false },
	{ id: 'media', label: 'Media', href: '/media', family: 'media', mobile: false },
	{
		id: 'workflows',
		label: 'Automations',
		href: '/workflows',
		family: 'workflows',
		mobile: false
	},
	{
		id: 'accounts',
		label: 'Accounts',
		href: '/accounts',
		family: 'accounts',
		mobile: false
	},
	{ id: 'settings', label: 'Settings', href: '/settings', family: 'settings', mobile: false }
];

const overviewNavigationIds = ['home', 'publications', 'communications', 'analytics'] as const;
const makeNavigationIds = ['ideate', 'studio', 'media', 'workflows'] as const;
const mobileNavigationOrder = ['home', 'publications', 'new', 'communications'] as const;

function navigationItems(ids: readonly PrimaryNavigationItem['id'][]) {
	return ids.map((id) => primaryNavigation.find((item) => item.id === id)!);
}

export const overviewNavigation = navigationItems(overviewNavigationIds);
export const makeNavigation = navigationItems(makeNavigationIds);
export const mobileNavigation = navigationItems(mobileNavigationOrder);

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

export function isEditorRoute(pathname: string): boolean {
	return (
		isLocalEditorRoute(pathname) ||
		pathname === '/image-editor' ||
		pathname.startsWith('/image-editor/')
	);
}

export function isMoreNavigationRoute(pathname: string): boolean {
	return !mobileNavigation.some((item) => isNavigationItemActive(item, pathname));
}

export function isOrganizationOwnershipSettingsRoute(url: URL): boolean {
	return (
		url.pathname === '/settings' &&
		(url.searchParams.get('tab') === 'ownership' || url.hash === '#ownership')
	);
}
