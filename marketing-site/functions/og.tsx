import { ImageResponse } from '@cloudflare/pages-plugin-vercel-og/api';
import type { PagesFunction } from '@cloudflare/workers-types';
import { resolveSocialImageEntry, socialImagePlatformSlugs } from '@openpost/social-images';
import React from 'react';

// The inset frame and title-led composition adapt the MIT-licensed ogimagecn
// Grid and ShadcnRegistry6 components. See licenses/OGIMAGECN.txt.
const WIDTH = 1200;
const HEIGHT = 630;
const MAX_TITLE = 90;
const MAX_DESCRIPTION = 180;
const MAX_LABEL = 48;
const FRAME = 48;

const colors = {
	canvas: '#fbfaf7',
	surfaceAlt: '#f2efea',
	ink: '#302b28',
	muted: '#726a64',
	border: '#e3ded7',
	orange: '#b74c05',
	dark: '#191512',
	darkInk: '#f4f0eb',
	darkMuted: '#aaa19a',
	darkBorder: '#3a332f'
};

type OgKind =
	| 'home'
	| 'workflow'
	| 'platforms'
	| 'platform'
	| 'tools-index'
	| 'tool'
	| 'security'
	| 'self-hosting'
	| 'document'
	| 'docs';

type OgInput = {
	kind: OgKind;
	title: string;
	description: string;
	label: string;
	platform?: string;
};

function parseInput(url: URL): OgInput {
	const entry = resolveSocialImageEntry(url.searchParams.get('id')?.trim() || '');
	return {
		kind: entry.kind,
		title: entry.socialTitle.slice(0, MAX_TITLE),
		description: entry.description.slice(0, MAX_DESCRIPTION),
		label: entry.label.slice(0, MAX_LABEL),
		platform: entry.platform
	};
}

function Frame({ color }: { color: string }) {
	return (
		<>
			<span
				style={{
					position: 'absolute',
					left: FRAME,
					top: 0,
					display: 'flex',
					width: 1,
					height: HEIGHT,
					background: color
				}}
			/>
			<span
				style={{
					position: 'absolute',
					right: FRAME,
					top: 0,
					display: 'flex',
					width: 1,
					height: HEIGHT,
					background: color
				}}
			/>
			<span
				style={{
					position: 'absolute',
					left: 0,
					top: FRAME,
					display: 'flex',
					width: WIDTH,
					height: 1,
					background: color
				}}
			/>
			<span
				style={{
					position: 'absolute',
					left: 0,
					bottom: FRAME,
					display: 'flex',
					width: WIDTH,
					height: 1,
					background: color
				}}
			/>
		</>
	);
}

type CardVariant = 'marketing' | 'docs';

function Brand({ origin, variant }: { origin: string; variant: CardVariant }) {
	const isDocs = variant === 'docs';
	return (
		<div
			style={{
				position: 'absolute',
				left: 78,
				top: 74,
				display: 'flex',
				alignItems: 'center',
				gap: 14
			}}
		>
			<img
				src={`${origin}/assets/brand/logo.svg`}
				width="42"
				height="42"
				style={{ objectFit: 'contain' }}
			/>
			<span
				style={{
					display: 'flex',
					color: isDocs ? colors.darkInk : colors.ink,
					fontFamily: 'Manrope',
					fontSize: 27,
					fontWeight: 600,
					letterSpacing: -0.5
				}}
			>
				OpenPost{isDocs ? ' Docs' : ''}
			</span>
		</div>
	);
}

function SignalField({ kind }: { kind: OgKind }) {
	const activeByKind: Record<OgKind, number[]> = {
		home: [1, 4, 6, 9, 11, 14],
		workflow: [0, 5, 10, 15],
		platforms: [1, 2, 4, 7, 8, 11, 13, 14],
		platform: [5, 6, 9, 10],
		'tools-index': [0, 3, 5, 6, 9, 10, 12, 15],
		tool: [1, 5, 9, 13],
		security: [1, 2, 4, 7, 9, 10, 13, 14],
		'self-hosting': [0, 1, 2, 4, 6, 8, 9, 10],
		document: [0, 1, 2, 4, 6, 8, 10, 12, 13, 14],
		docs: [0, 5, 10, 15]
	};
	const active = new Set(activeByKind[kind]);

	return (
		<div style={{ display: 'flex', flexWrap: 'wrap', width: 196, gap: 12 }}>
			{Array.from({ length: 16 }, (_, index) => (
				<span
					key={index}
					style={{
						display: 'flex',
						width: 40,
						height: 40,
						borderRadius: 9,
						background: active.has(index) ? colors.ink : colors.surfaceAlt
					}}
				/>
			))}
		</div>
	);
}

function PlatformCollection({ origin }: { origin: string }) {
	return (
		<div style={{ display: 'flex', flexWrap: 'wrap', width: 196, gap: 12 }}>
			{socialImagePlatformSlugs.map((platform) => (
				<div
					key={platform}
					style={{
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						width: 40,
						height: 40,
						borderRadius: 9,
						background: colors.surfaceAlt
					}}
				>
					<img src={`${origin}/assets/logos/${platform}.svg`} width="22" height="22" />
				</div>
			))}
			{Array.from({ length: 6 }, (_, index) => (
				<span
					key={index}
					style={{
						display: 'flex',
						width: 40,
						height: 40,
						borderRadius: 9,
						background: index === 1 || index === 5 ? colors.ink : colors.surfaceAlt
					}}
				/>
			))}
		</div>
	);
}

function MarketingMotif({ input, origin }: { input: OgInput; origin: string }) {
	if (input.kind === 'home') {
		return <img src={`${origin}/assets/brand/logo.svg`} width="170" height="170" />;
	}

	if (input.kind === 'platform' && input.platform) {
		return (
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					width: 188,
					height: 188,
					borderRadius: 30,
					background: colors.surfaceAlt
				}}
			>
				<img src={`${origin}/assets/logos/${input.platform}.svg`} width="94" height="94" />
			</div>
		);
	}

	if (input.kind === 'platforms') return <PlatformCollection origin={origin} />;
	return <SignalField kind={input.kind} />;
}

function marketingTitleSize(title: string) {
	if (title.length > 60) return 52;
	if (title.length > 46) return 57;
	return 64;
}

function CardShell({
	variant,
	input,
	origin,
	children
}: {
	variant: CardVariant;
	input: OgInput;
	origin: string;
	children: React.ReactNode;
}) {
	const isDocs = variant === 'docs';
	const ink = isDocs ? colors.darkInk : colors.ink;
	return (
		<div
			style={{
				position: 'relative',
				display: 'flex',
				width: WIDTH,
				height: HEIGHT,
				overflow: 'hidden',
				background: isDocs ? colors.dark : colors.canvas,
				color: ink,
				fontFamily: 'Geist'
			}}
		>
			<Frame color={isDocs ? colors.darkBorder : colors.border} />
			<Brand origin={origin} variant={variant} />
			<span
				style={{
					position: 'absolute',
					right: 78,
					top: 84,
					display: 'flex',
					color: isDocs ? colors.darkMuted : colors.muted,
					fontSize: 18
				}}
			>
				{isDocs ? 'docs.openpost.social' : 'openpost.social'}
			</span>

			{children}

			<div
				style={{
					position: 'absolute',
					left: 78,
					bottom: 78,
					display: 'flex',
					alignItems: 'center',
					gap: 12,
					color: ink,
					fontSize: 18,
					fontWeight: 600
				}}
			>
				<span
					style={{
						display: 'flex',
						width: 10,
						height: 10,
						borderRadius: 3,
						background: colors.orange
					}}
				/>
				{input.label}
			</div>
		</div>
	);
}

function MarketingCard({ input, origin }: { input: OgInput; origin: string }) {
	return (
		<CardShell variant="marketing" input={input} origin={origin}>
			<div
				style={{
					position: 'absolute',
					left: 78,
					top: 174,
					display: 'flex',
					flexDirection: 'column',
					width: 750
				}}
			>
				<div
					style={{
						display: 'flex',
						fontSize: marketingTitleSize(input.title),
						fontWeight: 600,
						letterSpacing: -1.8,
						lineHeight: 1.04
					}}
				>
					{input.title}
				</div>
				<div
					style={{
						display: 'flex',
						marginTop: 24,
						maxWidth: 720,
						color: colors.muted,
						fontSize: 24,
						lineHeight: 1.38
					}}
				>
					{input.description}
				</div>
			</div>

			<span
				style={{
					position: 'absolute',
					left: 876,
					top: 142,
					display: 'flex',
					width: 1,
					height: 338,
					background: colors.border
				}}
			/>
			<div
				style={{
					position: 'absolute',
					left: 920,
					top: 176,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					width: 196,
					height: 230
				}}
			>
				<MarketingMotif input={input} origin={origin} />
			</div>
		</CardShell>
	);
}

function docsTitleSize(title: string) {
	if (title.length > 54) return 62;
	if (title.length > 38) return 70;
	return 78;
}

function DocsCard({ input, origin }: { input: OgInput; origin: string }) {
	return (
		<CardShell variant="docs" input={input} origin={origin}>
			<div
				style={{
					position: 'absolute',
					left: 78,
					top: 180,
					display: 'flex',
					flexDirection: 'column',
					width: 1035
				}}
			>
				<div
					style={{
						display: 'flex',
						fontSize: docsTitleSize(input.title),
						fontWeight: 600,
						letterSpacing: -2.1,
						lineHeight: 1.02
					}}
				>
					{input.title}
				</div>
				<div
					style={{
						display: 'flex',
						marginTop: 28,
						maxWidth: 930,
						color: colors.darkMuted,
						fontSize: 27,
						lineHeight: 1.4
					}}
				>
					{input.description}
				</div>
			</div>
		</CardShell>
	);
}

function SocialCard({ input, origin }: { input: OgInput; origin: string }) {
	if (input.kind === 'docs') return <DocsCard input={input} origin={origin} />;
	return <MarketingCard input={input} origin={origin} />;
}

async function font(origin: string, name: string) {
	const response = await fetch(`${origin}/assets/brand/fonts/${name}`);
	if (!response.ok) throw new Error(`Could not load ${name}`);
	return response.arrayBuffer();
}

export const onRequestGet: PagesFunction = async ({ request }) => {
	const url = new URL(request.url);
	const input = parseInput(url);
	try {
		const [regular, semibold, wordmark] = await Promise.all([
			font(url.origin, 'Geist-Regular.ttf'),
			font(url.origin, 'Geist-SemiBold.ttf'),
			font(url.origin, 'Manrope-SemiBold.ttf')
		]);
		return new ImageResponse(<SocialCard input={input} origin={url.origin} />, {
			width: WIDTH,
			height: HEIGHT,
			fonts: [
				{ name: 'Geist', data: regular, weight: 400, style: 'normal' },
				{ name: 'Geist', data: semibold, weight: 600, style: 'normal' },
				{ name: 'Manrope', data: wordmark, weight: 600, style: 'normal' }
			],
			headers: {
				'X-Robots-Tag': 'noindex'
			}
		});
	} catch (error) {
		console.error('OpenPost OG rendering failed', error);
		return Response.redirect(`${url.origin}/assets/brand/og-image.png`, 302);
	}
};
