import { z } from 'zod';
import { parse } from 'shell-quote';
import type { Value } from './api';
import { m } from '$lib/paraglide/messages';
export function importCurl(command: string) {
	if (command.length > 20000) throw new Error(m.workflows_curl_invalid());
	const parsed = parse(command.replace(/\\\r?\n/g, ' '), () => {
		throw new Error(m.workflows_curl_invalid());
	});
	const tokens = z.array(z.string()).safeParse(parsed);
	if (!tokens.success || tokens.data[0] !== 'curl') throw new Error(m.workflows_curl_invalid());
	const args = tokens.data;
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
	for (let i = 1; i < args.length; i++) {
		const arg = args[i];
		if (['-X', '--request'].includes(arg)) method = next(++i).toUpperCase();
		else if (arg === '--url') url = next(++i);
		else if (['-H', '--header'].includes(arg)) {
			const raw = next(++i),
				colon = raw.indexOf(':');
			if (colon < 1) throw new Error(m.workflows_curl_invalid());
			const name = raw.slice(0, colon).trim();
			if (/authorization|cookie|token|secret|api-?key/i.test(name))
				throw new Error(m.workflows_curl_secret());
			headers[name] = raw.slice(colon + 1).trim();
		} else if (['-d', '--data', '--data-raw', '--data-binary', '--json'].includes(arg)) {
			const value = next(++i);
			if (value.startsWith('@'))
				throw new Error(m.workflows_curl_unsupported({ flag: arg + ' @file' }));
			body += (body ? '&' : '') + value;
			if (arg === '--json') {
				headers['Content-Type'] = 'application/json';
				headers.Accept = 'application/json';
			}
		} else if (arg === '--data-urlencode' || arg === '--url-query') {
			const value = next(++i),
				equal = value.indexOf('=');
			if (equal < 1) throw new Error(m.workflows_curl_invalid());
			if (arg === '--url-query') query[value.slice(0, equal)] = value.slice(equal + 1);
			else
				body +=
					(body ? '&' : '') +
					encodeURIComponent(value.slice(0, equal)) +
					'=' +
					encodeURIComponent(value.slice(equal + 1));
		} else if (arg === '--max-time' || arg === '-m') timeout = Number(next(++i));
		else if (arg === '-G' || arg === '--get') get = true;
		else if (arg === '-I' || arg === '--head') method = 'HEAD';
		else if (arg === '-A' || arg === '--user-agent') headers['User-Agent'] = next(++i);
		else if (
			[
				'--compressed',
				'--silent',
				'-s',
				'--show-error',
				'-S',
				'--fail',
				'-f',
				'--location',
				'-L'
			].includes(arg)
		)
			continue;
		else if (arg.startsWith('-')) throw new Error(m.workflows_curl_unsupported({ flag: arg }));
		else if (url) throw new Error(m.workflows_curl_invalid());
		else url = arg;
	}
	let address: URL;
	try {
		address = new URL(url);
	} catch {
		throw new Error(m.workflows_curl_invalid());
	}
	if (!['http:', 'https:'].includes(address.protocol) || address.username || address.password)
		throw new Error(m.workflows_curl_invalid());
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
