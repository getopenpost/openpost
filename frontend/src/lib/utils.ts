import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export type WithoutChild<T> = T extends { child?: any } ? Omit<T, 'child'> : T;
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, 'children'> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };

export function getPlatformKey(platform: string): string {
	const key = platform.toLowerCase().split(':')[0];

	switch (key) {
		case 'twitter':
		case 'x':
			return 'x';
		case 'mastodon':
			return 'mastodon';
		case 'threads':
			return 'threads';
		case 'bluesky':
			return 'bluesky';
		case 'linkedin':
			return 'linkedin';
		case 'instagram':
			return 'instagram';
		case 'facebook':
			return 'facebook';
		case 'youtube':
			return 'youtube';
		case 'tiktok':
			return 'tiktok';
		default:
			return key;
	}
}

export function getPlatformName(platform: string): string {
	switch (getPlatformKey(platform)) {
		case 'x':
			return 'X';
		case 'mastodon':
			return 'Mastodon';
		case 'threads':
			return 'Threads';
		case 'bluesky':
			return 'Bluesky';
		case 'linkedin':
			return 'LinkedIn';
		case 'instagram':
			return 'Instagram';
		case 'facebook':
			return 'Facebook';
		case 'youtube':
			return 'YouTube';
		case 'tiktok':
			return 'TikTok';
		default:
			return platform.split(':')[0];
	}
}

export function formatAccountHandle(username: string | null | undefined): string {
	const normalizedUsername = username?.trim().replace(/^@+/, '');
	return normalizedUsername ? `@${normalizedUsername}` : '';
}

export function getStatusColor(status: string): string {
	const colors: Record<string, string> = {
		draft: 'bg-muted text-muted-foreground',
		scheduled: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
		publishing: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
		published: 'bg-green-500/10 text-green-600 dark:text-green-400',
		failed: 'bg-red-500/10 text-red-600 dark:text-red-400'
	};
	return colors[status] || 'bg-muted text-muted-foreground';
}

export function getPlatformColor(platform: string): string {
	const colors: Record<string, string> = {
		x: 'bg-black',
		mastodon: 'bg-indigo-500',
		threads: 'bg-orange-500',
		bluesky: 'bg-sky-500',
		linkedin: 'bg-blue-600',
		instagram: 'bg-pink-500',
		facebook: 'bg-blue-700',
		youtube: 'bg-red-600',
		tiktok: 'bg-zinc-900'
	};
	return colors[getPlatformKey(platform)] || 'bg-gray-500';
}
