import type { MarketingRouteEntry } from '@openpost/social-images';
import {
	agentPublishingDocsUrl,
	developerDocsUrl,
	discordCommunityUrl,
	faqs,
	githubUrl,
	siteUrl,
	supportEmail,
	userDocsUrl
} from './_marketing';

const websiteId = `${siteUrl}/#website`;
const softwareId = `${siteUrl}/#software`;
const operatorId = `${siteUrl}/#operator`;

function pageType(path: string) {
	if (path === '/about') return 'AboutPage';
	if (path === '/contact') return 'ContactPage';
	if (path === '/faq') return 'FAQPage';
	return 'WebPage';
}

function pageData(entry: MarketingRouteEntry) {
	const data = {
		'@id': `${entry.canonical}#webpage`,
		'@type': pageType(entry.path),
		url: entry.canonical,
		name: entry.title,
		description: entry.description,
		inLanguage: 'en',
		isPartOf: { '@id': websiteId },
		about: { '@id': softwareId },
		publisher: { '@id': operatorId }
	};
	if (entry.path === '/faq') {
		return {
			...data,
			mainEntity: faqs.map((faq) => ({
				'@type': 'Question',
				name: faq.question,
				acceptedAnswer: {
					'@type': 'Answer',
					text: faq.answer
				}
			}))
		};
	}
	return data;
}

export function structuredDataForMarketingPage(entry: MarketingRouteEntry) {
	return {
		'@context': 'https://schema.org',
		'@graph': [
			{
				'@id': websiteId,
				'@type': 'WebSite',
				name: 'OpenPost',
				url: siteUrl,
				description:
					'OpenPost helps solo founders create, adapt, schedule, publish, and track social content from one workspace.',
				inLanguage: 'en',
				publisher: { '@id': operatorId },
				about: { '@id': softwareId }
			},
			{
				'@id': softwareId,
				'@type': ['SoftwareApplication', 'WebApplication'],
				name: 'OpenPost',
				url: siteUrl,
				applicationCategory: 'BusinessApplication',
				operatingSystem: 'Web, Android',
				description:
					'An all-in-one social publishing workspace with a web app, HTTP API, CLI, MCP server, and self-hosted deployment option.',
				softwareHelp: userDocsUrl,
				license: `${githubUrl}/blob/main/LICENSE`,
				author: { '@id': operatorId },
				featureList: [
					'Destination-specific social content',
					'Scheduling and durable publishing jobs',
					'Media library and editors',
					'Analytics and supported conversations',
					'HTTP API, CLI, and MCP automation',
					'Self-hosted deployment'
				],
				sameAs: [githubUrl],
				subjectOf: [developerDocsUrl, agentPublishingDocsUrl, discordCommunityUrl]
			},
			{
				'@id': `${siteUrl}/#source`,
				'@type': 'SoftwareSourceCode',
				name: 'OpenPost source code',
				codeRepository: githubUrl,
				programmingLanguage: ['Go', 'TypeScript', 'Svelte'],
				license: `${githubUrl}/blob/main/LICENSE`,
				runtimePlatform: ['Web', 'Linux', 'Android'],
				about: { '@id': softwareId }
			},
			{
				'@id': operatorId,
				'@type': 'Person',
				name: 'Rodrigo Dias',
				url: `${siteUrl}/about`,
				email: supportEmail,
				homeLocation: {
					'@type': 'Place',
					address: {
						'@type': 'PostalAddress',
						addressLocality: 'Porto',
						addressCountry: 'PT'
					}
				},
				contactPoint: {
					'@type': 'ContactPoint',
					contactType: 'customer support',
					email: supportEmail,
					url: `${siteUrl}/contact`,
					availableLanguage: ['English', 'Portuguese']
				}
			},
			pageData(entry)
		]
	};
}
