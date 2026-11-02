export const postizSocialLogos = {
	bluesky: 'Bluesky.svg',
	discord: 'Discord.svg',
	facebook: 'Facebook.svg',
	instagram: 'Instagram.svg',
	lemmy: 'Lemmy.svg',
	linkedin: 'Linkedin.svg',
	mastodon: 'Mastodon.svg',
	peertube: 'Peertube.svg',
	piefed: 'PieFed.svg',
	pixelfed: 'Pixelfed.svg',
	threads: 'Threads.svg',
	tiktok: 'TikTok.svg',
	x: 'X.svg'
} as const;

export type PostizSocialLogo = keyof typeof postizSocialLogos;

export function postizSocialLogoSource(platform: PostizSocialLogo) {
	return `/assets/postiz-socials/${postizSocialLogos[platform]}`;
}
