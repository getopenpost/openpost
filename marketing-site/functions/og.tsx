import { ImageResponse } from '@cloudflare/pages-plugin-vercel-og/api';
import type { PagesFunction } from '@cloudflare/workers-types';
import { resolveSocialImageEntry } from '@openpost/social-images';
import React from 'react';

const WIDTH = 1200;
const HEIGHT = 630;
const MAX_TITLE = 90;
const MAX_DESCRIPTION = 180;
const MAX_LABEL = 48;
const colors = {
	canvas: '#fbfaf7',
	surface: '#ffffff',
	surfaceAlt: '#f2efea',
	ink: '#2c2825',
	muted: '#786f68',
	border: '#e3ded7',
	orange: '#b74c05',
	orangeSoft: '#f0c9ad',
	orangePale: '#f8e5d6',
	dark: '#1a1512'
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
	subject?: string;
	platform?: string;
};

function parseInput(url: URL): OgInput {
	const entry = resolveSocialImageEntry(url.searchParams.get('id')?.trim() || '');
	return {
		kind: entry.kind,
		title: entry.socialTitle.slice(0, MAX_TITLE),
		description: entry.description.slice(0, MAX_DESCRIPTION),
		label: entry.label.slice(0, MAX_LABEL),
		subject: entry.subject?.slice(0, MAX_LABEL),
		platform: entry.platform
	};
}

function ActivityGrid({ columns = 11, rows = 6 }: { columns?: number; rows?: number }) {
	const palette = [colors.surfaceAlt, colors.orangePale, colors.orangeSoft, colors.orange];
	return (
		<div style={{ display: 'flex', flexWrap: 'wrap', width: columns * 29, gap: 8 }}>
			{Array.from({ length: columns * rows }, (_, index) => {
				const row = Math.floor(index / columns);
				const column = index % columns;
				const score = (column * 7 + row * 11 + column * row) % 15;
				const level = score > 12 ? 3 : score > 9 ? 2 : score > 5 ? 1 : 0;
				return (
					<div
						key={index}
						style={{
							display: 'flex',
							width: 21,
							height: 21,
							borderRadius: 5,
							background: palette[level]
						}}
					/>
				);
			})}
		</div>
	);
}

function WorkflowMotif() {
	return (
		<div
			style={{
				position: 'absolute',
				right: 52,
				top: 142,
				width: 444,
				height: 348,
				display: 'flex',
				flexDirection: 'column',
				padding: '42px 38px',
				border: `1px solid ${colors.border}`,
				borderRadius: 24,
				background: colors.surface
			}}
		>
			<div
				style={{
					display: 'flex',
					color: colors.muted,
					fontSize: 13,
					fontWeight: 600,
					letterSpacing: 1.4
				}}
			>
				ONE CONTENT SYSTEM
			</div>
			<div style={{ display: 'flex', marginTop: 28 }}>
				<ActivityGrid />
			</div>
			<svg width="350" height="58" viewBox="0 0 350 58" style={{ marginTop: 18 }}>
				<path
					d="M 6 42 C 68 8 102 58 162 28 C 221 0 263 54 344 13"
					fill="none"
					stroke={colors.orange}
					strokeWidth="4"
					strokeLinecap="round"
				/>
			</svg>
		</div>
	);
}

function HomeMotif({ origin }: { origin: string }) {
	return (
		<div
			style={{
				position: 'absolute',
				right: 44,
				top: 142,
				width: 458,
				height: 348,
				display: 'flex',
				padding: 16,
				borderRadius: 24,
				background: colors.dark
			}}
		>
			<img
				src={`${origin}/assets/screenshots/main-dark.png`}
				width="426"
				height="316"
				style={{ objectFit: 'cover', objectPosition: 'left', borderRadius: 15 }}
			/>
			<div
				style={{
					position: 'absolute',
					left: -22,
					bottom: 4,
					display: 'flex',
					alignItems: 'center',
					gap: 12,
					width: 158,
					height: 48,
					padding: '0 18px',
					border: `1px solid ${colors.border}`,
					borderRadius: 12,
					background: colors.surface,
					color: colors.ink,
					fontSize: 16,
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
				Publish
			</div>
		</div>
	);
}

function PlatformMotif({
	origin,
	platform,
	subject
}: {
	origin: string;
	platform?: string;
	subject?: string;
}) {
	return (
		<div
			style={{
				position: 'absolute',
				right: 116,
				top: 128,
				width: 336,
				height: 336,
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				paddingTop: 48,
				border: `1px solid ${colors.border}`,
				borderRadius: 30,
				background: colors.surface
			}}
		>
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					width: 180,
					height: 180,
					borderRadius: 42,
					background: colors.surfaceAlt
				}}
			>
				{platform ? (
					<img src={`${origin}/assets/logos/${platform}.svg`} width="76" height="76" />
				) : null}
			</div>
			<div
				style={{
					display: 'flex',
					marginTop: 18,
					color: colors.muted,
					fontSize: 14
				}}
			>
				{subject || 'Destination'}
			</div>
			<div
				style={{
					position: 'absolute',
					right: -26,
					bottom: -10,
					display: 'flex',
					alignItems: 'center',
					gap: 10,
					padding: '13px 18px',
					border: `1px solid ${colors.orangeSoft}`,
					borderRadius: 12,
					background: colors.orangePale,
					color: colors.ink,
					fontSize: 16,
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
				Publish
			</div>
		</div>
	);
}

function ToolMotif({ subject }: { subject?: string }) {
	return (
		<div
			style={{
				position: 'absolute',
				right: 50,
				top: 142,
				width: 452,
				height: 352,
				display: 'flex',
				flexDirection: 'column',
				border: `1px solid ${colors.border}`,
				borderRadius: 24,
				background: colors.surface,
				overflow: 'hidden'
			}}
		>
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: 10,
					height: 52,
					paddingLeft: 28,
					background: colors.surfaceAlt
				}}
			>
				{[colors.orange, colors.border, colors.border].map((color, index) => (
					<span
						key={index}
						style={{
							display: 'flex',
							width: 12,
							height: 12,
							borderRadius: 6,
							background: color
						}}
					/>
				))}
			</div>
			<div
				style={{
					display: 'flex',
					flexDirection: 'column',
					padding: '42px 38px'
				}}
			>
				<span
					style={{
						display: 'flex',
						width: 250,
						height: 18,
						borderRadius: 9,
						background: colors.border
					}}
				/>
				<span
					style={{
						display: 'flex',
						width: 322,
						height: 14,
						marginTop: 16,
						borderRadius: 7,
						background: colors.surfaceAlt
					}}
				/>
				<span
					style={{
						display: 'flex',
						width: 278,
						height: 14,
						marginTop: 14,
						borderRadius: 7,
						background: colors.surfaceAlt
					}}
				/>
				<span
					style={{
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						width: 146,
						height: 48,
						marginTop: 52,
						borderRadius: 12,
						background: colors.orange,
						color: '#fff8f3',
						fontSize: 16,
						fontWeight: 600
					}}
				>
					Use the tool
				</span>
				<span
					style={{
						display: 'flex',
						marginTop: 26,
						color: colors.muted,
						fontSize: 14
					}}
				>
					{subject || 'Free browser tool'}
				</span>
			</div>
		</div>
	);
}

function Motif({ input, origin }: { input: OgInput; origin: string }) {
	if (input.kind === 'home') return <HomeMotif origin={origin} />;
	if (input.kind === 'platform')
		return <PlatformMotif origin={origin} platform={input.platform} subject={input.subject} />;
	if (input.kind === 'tool') return <ToolMotif subject={input.subject} />;
	return <WorkflowMotif />;
}

function SocialCard({ input, origin }: { input: OgInput; origin: string }) {
	const titleSize = input.title.length > 62 ? 48 : 56;
	return (
		<div
			style={{
				position: 'relative',
				display: 'flex',
				width: WIDTH,
				height: HEIGHT,
				background: colors.canvas,
				color: colors.ink,
				fontFamily: 'Geist'
			}}
		>
			<span
				style={{
					position: 'absolute',
					left: 0,
					top: 0,
					display: 'flex',
					width: 18,
					height: HEIGHT,
					background: colors.orange
				}}
			/>
			<img
				src={`${origin}/assets/brand/logo.svg`}
				width="64"
				height="50"
				style={{
					position: 'absolute',
					left: 62,
					top: 34,
					objectFit: 'contain',
					objectPosition: 'left center'
				}}
			/>
			<span
				style={{
					position: 'absolute',
					left: 128,
					top: 48,
					display: 'flex',
					color: colors.ink,
					fontFamily: 'Manrope',
					fontSize: 28,
					fontWeight: 600,
					letterSpacing: -0.55
				}}
			>
				OpenPost
			</span>
			<div
				style={{
					position: 'absolute',
					left: 72,
					top: 136,
					width: 570,
					display: 'flex',
					flexDirection: 'column'
				}}
			>
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 14,
						color: colors.orange,
						fontSize: 14,
						fontWeight: 600,
						letterSpacing: 1.5,
						textTransform: 'uppercase'
					}}
				>
					<span
						style={{
							display: 'flex',
							width: 9,
							height: 9,
							borderRadius: 3,
							background: colors.orange
						}}
					/>
					{input.label}
				</div>
				<div
					style={{
						display: 'flex',
						marginTop: 20,
						fontSize: titleSize,
						lineHeight: 1.06,
						fontWeight: 600,
						letterSpacing: -2.1
					}}
				>
					{input.title}
				</div>
				<div
					style={{
						display: 'flex',
						marginTop: 28,
						maxWidth: 530,
						color: colors.muted,
						fontSize: 21,
						lineHeight: 1.42
					}}
				>
					{input.description}
				</div>
			</div>
			<Motif input={input} origin={origin} />
			<span
				style={{
					position: 'absolute',
					left: 18,
					bottom: 77,
					display: 'flex',
					width: 1182,
					height: 1,
					background: colors.border
				}}
			/>
			<span
				style={{
					position: 'absolute',
					left: 72,
					bottom: 35,
					display: 'flex',
					color: colors.muted,
					fontSize: 17
				}}
			>
				openpost.social
			</span>
			<div
				style={{
					position: 'absolute',
					right: 86,
					bottom: 34,
					display: 'flex',
					gap: 8
				}}
			>
				{[
					colors.surfaceAlt,
					colors.orangePale,
					colors.orange,
					colors.orangePale,
					colors.orange,
					colors.surfaceAlt
				].map((color, index) => (
					<span
						key={index}
						style={{
							display: 'flex',
							width: 12,
							height: 12,
							borderRadius: 5,
							background: color
						}}
					/>
				))}
			</div>
		</div>
	);
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
