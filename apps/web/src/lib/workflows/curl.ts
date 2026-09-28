import { z } from 'zod';
import { parse } from 'shell-quote';
import type { Value } from './api';
import { m } from '$lib/paraglide/messages';
export function importCurl(command: string) {
	const args = parseArguments(command);
	let url = '',
		method = '',
		body = '',
		get = false;
	const headers: Record<string, string> = {};
	const query: Record<string, string> = {};
	let timeout = 20;
	function next(i: number) {
		const value = args[i];
		if (value === undefined) throw new Error(m.workflows_curl_invalid());
		return value;
	}
	const aliases = new Map(
		Object.entries({
			'-X': '--request',
			'-H': '--header',
			'-d': '--data',
			'-m': '--max-time',
			'-A': '--user-agent',
			'-G': '--get',
			'-I': '--head',
			'--data-raw': '--data',
			'--data-binary': '--data'
		})
	);
	const withValue = new Map(
		Object.entries({
			'--request': (value) => {
				method = value.toUpperCase();
			},
			'--url': (value) => {
				url = value;
			},
			'--header': (value) => {
				const [name, content] = parseHeader(value);
				headers[name] = content;
			},
			'--data': (value) => {
				body = appendBody(body, value);
			},
			'--json': (value) => {
				body = appendBody(body, value);
				headers['Content-Type'] = 'application/json';
				headers.Accept = 'application/json';
			},
			'--data-urlencode': (value) => {
				const [name, content] = parseQuery(value);
				body = appendBody(body, encodeURIComponent(name) + '=' + encodeURIComponent(content));
			},
			'--url-query': (value) => {
				const [name, content] = parseQuery(value);
				query[name] = content;
			},
			'--max-time': (value) => {
				timeout = Number(value);
			},
			'--user-agent': (value) => {
				headers['User-Agent'] = value;
			}
		} satisfies Record<string, (value: string) => void>)
	);
	const ignored = new Set([
		'--compressed',
		'--silent',
		'-s',
		'--show-error',
		'-S',
		'--fail',
		'-f',
		'--location',
		'-L'
	]);
	for (let i = 1; i < args.length; i++) {
		const arg = aliases.get(args[i]) ?? args[i];
		const handler = withValue.get(arg);
		if (handler) handler(next(++i));
		else if (arg === '--get') get = true;
		else if (arg === '--head') method = 'HEAD';
		else if (ignored.has(arg)) continue;
		else if (arg.startsWith('-')) throw new Error(m.workflows_curl_unsupported({ flag: arg }));
		else if (url) throw new Error(m.workflows_curl_invalid());
		else url = arg;
	}
	return requestValues({ url, method, body, get, headers, query, timeout });
}
function requestValues({
	url,
	method,
	body,
	get,
	headers,
	query,
	timeout
}: {
	url: string;
	method: string;
	body: string;
	get: boolean;
	headers: Record<string, string>;
	query: Record<string, string>;
	timeout: number;
}) {
	const address = requestURL(url);
	if (body && !Object.keys(headers).some((key) => key.toLowerCase() === 'content-type'))
		headers['Content-Type'] = 'application/x-www-form-urlencoded';
	if (get && body) {
		new URLSearchParams(body).forEach((value, key) => (query[key] = value));
		body = '';
	}
	return {
		url: { literal: address.href },
		method: { literal: method || (get ? 'GET' : body ? 'POST' : 'GET') },
		headers: { literal: headers },
		query: { literal: query },
		body: { literal: body },
		timeout: { literal: timeout }
	} satisfies Record<string, Value>;
}

function requestURL(url: string): URL {
	let address: URL;
	try {
		address = new URL(url);
	} catch {
		throw new Error(m.workflows_curl_invalid());
	}
	if (!['http:', 'https:'].includes(address.protocol) || address.username || address.password)
		throw new Error(m.workflows_curl_invalid());
	return address;
}
function parseHeader(raw: string): [string, string] {
	const colon = raw.indexOf(':');
	if (colon < 1) throw new Error(m.workflows_curl_invalid());
	const name = raw.slice(0, colon).trim();
	if (/authorization|cookie|token|secret|api-?key/i.test(name))
		throw new Error(m.workflows_curl_secret());
	return [name, raw.slice(colon + 1).trim()];
}
function parseQuery(value: string): [string, string] {
	const equal = value.indexOf('=');
	if (equal < 1) throw new Error(m.workflows_curl_invalid());
	return [value.slice(0, equal), value.slice(equal + 1)];
}
function appendBody(body: string, value: string): string {
	if (value.startsWith('@')) throw new Error(m.workflows_curl_unsupported({ flag: '@file' }));
	return body + (body ? '&' : '') + value;
}

function parseArguments(command: string): string[] {
	if (command.length > 20000) throw new Error(m.workflows_curl_invalid());
	const parsed = parse(command.replace(/\\\r?\n/g, ' '), () => {
		throw new Error(m.workflows_curl_invalid());
	});
	const tokens = z.array(z.string()).safeParse(parsed);
	if (!tokens.success || tokens.data[0] !== 'curl') throw new Error(m.workflows_curl_invalid());
	return tokens.data;
}
