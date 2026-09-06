export const postizSocialLogos = {
	bluesky: 'Bluesky.svg',
	discord: 'Discord.svg',
	facebook: 'Facebook.svg',
	instagram: 'Instagram.svg',
	linkedin: 'Linkedin.svg',
	mastodon: 'Mastodon.svg',
	threads: 'Threads.svg',
	tiktok: 'TikTok.svg',
	x: 'X.svg',
	youtube: 'Youtube.svg'
} as const;

export type PostizSocialLogo = keyof typeof postizSocialLogos;

export function postizSocialLogoSource(platform: PostizSocialLogo) {
	return `/assets/postiz-socials/${postizSocialLogos[platform]}`;
}
