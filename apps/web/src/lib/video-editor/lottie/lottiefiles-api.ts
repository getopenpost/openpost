import type { MediaAttribution } from '../media/types';

const ENDPOINT = 'https://graphql.lottiefiles.com/2022-08';
export const LOTTIEFILES_LICENSE = 'Lottie Simple License (FL 9.13.21)';
export const LOTTIEFILES_LICENSE_URL = 'https://lottiefiles.com/page/license';

export type LottieBrowseCategory = 'featured' | 'popular' | 'recent';

export interface LottieFilesAnimation {
	id: string;
	name: string;
	lottieUrl: string;
	gifUrl: string | null;
	bgColor: string | null;
	author: string | null;
	authorPath: string | null;
}

export interface LottiePage {
	items: LottieFilesAnimation[];
	endCursor: string | null;
	hasNextPage: boolean;
	totalCount: number;
}

interface RawNode {
	id: number | string;
	name: string | null;
	lottieUrl: string | null;
	gifUrl: string | null;
	bgColor: string | null;
	createdBy: { name: string | null; username: string | null } | null;
}

interface RawConnection {
	totalCount?: number;
	pageInfo: { hasNextPage: boolean; endCursor: string | null };
	edges: Array<{ node: RawNode }>;
}

interface RawResponse {
	data?: {
		featuredPublicAnimations?: RawConnection | null;
		popularPublicAnimations?: RawConnection | null;
		recentPublicAnimations?: RawConnection | null;
		searchPublicAnimations?: RawConnection | null;
	};
	errors?: Array<{ message: string }>;
}

interface LottieQueryVariables {
	first: number;
	after: string | null;
	query?: string;
}

const NODE_FIELDS = `
  id
  name
  lottieUrl
  gifUrl
  bgColor
  createdBy { name username }
`;

export function offsetToCursor(offset: number): string {
	return btoa(`arrayconnection:${offset}`);
}

function rootField(
	category: LottieBrowseCategory,
	isSearch: boolean
): keyof NonNullable<RawResponse['data']> {
	if (isSearch) return 'searchPublicAnimations';
	if (category === 'popular') return 'popularPublicAnimations';
	if (category === 'recent') return 'recentPublicAnimations';
	return 'featuredPublicAnimations';
}

function buildQuery(field: string, isSearch: boolean): string {
	const variables = isSearch
		? '($first: Int!, $after: String, $query: String!)'
		: '($first: Int!, $after: String)';
	const argumentsList = isSearch
		? 'query: $query, first: $first, after: $after'
		: 'first: $first, after: $after';
	return `query LottieBrowse${variables} {
    ${field}(${argumentsList}) {
      totalCount
      pageInfo { hasNextPage endCursor }
      edges { node { ${NODE_FIELDS} } }
    }
  }`;
}

function mapNode(node: RawNode): LottieFilesAnimation | null {
	if (!node.lottieUrl) return null;
	return {
		id: String(node.id),
		name: node.name?.trim() || 'Untitled',
		lottieUrl: node.lottieUrl,
		gifUrl: node.gifUrl,
		bgColor: node.bgColor,
		author: node.createdBy?.name?.trim() || null,
		authorPath: node.createdBy?.username ?? null
	};
}

export async function fetchLottieAnimations(options: {
	category: LottieBrowseCategory;
	query?: string;
	after?: string | null;
	first?: number;
	signal?: AbortSignal;
}): Promise<LottiePage> {
	const query = options.query?.trim() ?? '';
	const isSearch = query.length > 0;
	const field = rootField(options.category, isSearch);
	const variables: LottieQueryVariables = {
		first: options.first ?? 24,
		after: options.after ?? null
	};
	if (isSearch) variables.query = query;

	const response = await fetch(ENDPOINT, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ query: buildQuery(field, isSearch), variables }),
		credentials: 'omit',
		referrerPolicy: 'no-referrer',
		signal: options.signal
	});
	if (!response.ok) throw new Error(`LottieFiles request failed (${response.status}).`);
	// SAFETY: all accessed fields are optional or mapped through the concrete response contract below.
	const json = (await response.json()) as RawResponse;
	if (json.errors?.length) {
		throw new Error(json.errors[0]?.message ?? 'LottieFiles returned an error.');
	}
	const connection = json.data?.[field];
	if (!connection) return { items: [], endCursor: null, hasNextPage: false, totalCount: 0 };
	const items = connection.edges
		.map((edge) => mapNode(edge.node))
		.filter((item): item is LottieFilesAnimation => item !== null);
	return {
		items,
		endCursor: connection.pageInfo.endCursor,
		hasNextPage: connection.pageInfo.hasNextPage,
		totalCount: connection.totalCount ?? items.length
	};
}

export function lottieFilesAttribution(animation: LottieFilesAnimation): MediaAttribution {
	const authorPath = animation.authorPath?.startsWith('/')
		? animation.authorPath
		: animation.authorPath
			? `/${animation.authorPath}`
			: undefined;
	return {
		provider: 'LottieFiles',
		author: animation.author ?? undefined,
		authorUrl: authorPath ? `https://lottiefiles.com${authorPath}` : undefined,
		sourceId: animation.id,
		license: LOTTIEFILES_LICENSE,
		licenseUrl: LOTTIEFILES_LICENSE_URL
	};
}
