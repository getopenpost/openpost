import type { ScreenshotDocument } from '@openpost/query-catalog';
import { m } from '$lib/paraglide/messages';
export type TemplateID = Exclude<ScreenshotDocument['template_id'], 'meme'>;
export type Conversation = NonNullable<ScreenshotDocument['conversation']>;
export type Receipt = NonNullable<ScreenshotDocument['receipt']>;
export type StatusPage = NonNullable<ScreenshotDocument['status_page']>;
export const TEMPLATE_IDS: TemplateID[] = ['messages', 'group-chat', 'receipt', 'status-page'];
export const TEMPLATE_WIDTH = 540;
export const EXPORT_SCALE = 2;
export const MAX_EXPORT_HEIGHT = 8192;
export function templateName(id: string): string {
	switch (id) {
		case 'meme':
			return m.media_picker_meme();
		case 'messages':
			return m.templates_messages();
		case 'group-chat':
			return m.templates_group_chat();
		case 'receipt':
			return m.templates_receipt();
		case 'status-page':
			return m.templates_status_page();
		default:
			return m.templates_title();
	}
}
export function newDocument(templateID: TemplateID): ScreenshotDocument {
	const common = {
		schema_version: 1,
		template_id: templateID,
		title: templateName(templateID),
		appearance: 'light',
		frame: 'natural',
		text_size: 'normal'
	} as const;
	switch (templateID) {
		case 'messages':
		case 'group-chat': {
			const group = templateID === 'group-chat';
			return {
				...common,
				conversation: {
					name: group ? 'Founders group chat' : 'Angel investor',
					timestamp: 'Today 10:19 AM',
					show_header: true,
					read_receipt: 'Read 10:21 AM',
					self_id: 'me',
					people: [
						{ id: 'me', name: 'Me' },
						{ id: 'alex', name: 'Alex' },
						...(group ? [{ id: 'sam', name: 'Sam' }] : [])
					],
					messages: group
						? [
								{ id: 'a', sender_id: 'me', text: 'We finally shipped it.' },
								{
									id: 'b',
									sender_id: 'alex',
									text: 'Congrats! How many users?'
								},
								{ id: 'c', sender_id: 'me', text: 'Three. Including us.' },
								{ id: 'd', sender_id: 'sam', text: 'I made two accounts.' }
							]
						: [
								{ id: 'a', sender_id: 'me', text: 'We just hit 10k users.' },
								{
									id: 'b',
									sender_id: 'alex',
									text: 'Amazing. What’s your revenue?'
								},
								{ id: 'c', sender_id: 'me', text: 'We just hit 10k users.' },
								{
									id: 'd',
									sender_id: 'alex',
									text: 'Read that loud and clear.'
								}
							]
				}
			};
		}
		case 'receipt':
			return {
				...common,
				receipt: {
					business: 'Sunrise Coffee Co.',
					address: '415 Mission St, San Francisco',
					timestamp: 'Sep 26, 2026 · 10:23 AM',
					order: '#4782',
					currency: 'USD',
					tax_percent: 8.25,
					custom_total: '',
					footer: 'Thanks for supporting a small business.',
					items: [
						{
							id: 'a',
							name: 'Double espresso',
							quantity: 1,
							amount_cents: 900
						},
						{
							id: 'b',
							name: 'A very good idea',
							quantity: 1,
							amount_cents: 1000000
						}
					]
				}
			};
		case 'status-page':
			return {
				...common,
				status_page: {
					name: 'Startup Status',
					headline: 'Elevated levels of optimism',
					severity: 'degraded',
					updates: [
						{
							id: 'a',
							stage: 'Monitoring',
							text: 'The demo worked. We are monitoring the situation closely.',
							timestamp: 'Sep 26, 2026 · 10:23 UTC'
						},
						{
							id: 'b',
							stage: 'Identified',
							text: 'The issue appears to be a working product.',
							timestamp: 'Sep 26, 2026 · 10:15 UTC'
						},
						{
							id: 'c',
							stage: 'Investigating',
							text: 'We are investigating reports of actual users.',
							timestamp: 'Sep 26, 2026 · 10:00 UTC'
						}
					]
				}
			};
	}
}
export function receiptTotals(receipt: Receipt) {
	const subtotal = (receipt.items ?? []).reduce(
		(sum, item) => sum + item.quantity * item.amount_cents,
		0
	);
	const tax = Math.round((subtotal * receipt.tax_percent) / 100);
	return { subtotal, tax, total: subtotal + tax };
}
export function receiptMoney(amount: number, currency: Receipt['currency']) {
	return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount / 100);
}
export function moveRow<T>(rows: T[], index: number, direction: -1 | 1): T[] {
	const next = index + direction;
	if (next < 0 || next >= rows.length) return rows;
	const result = rows.slice();
	[result[index], result[next]] = [result[next], result[index]];
	return result;
}
export function pasteConversation(text: string, conversation: Conversation): Conversation {
	const people = (conversation.people ?? []).map((person) => ({ ...person }));
	const messages: NonNullable<Conversation['messages']> = [];
	for (const line of text.trim().split(/\r?\n/)) {
		const match = /^([^:\n]{1,100}):\s*(.*)$/.exec(line);
		if (!match) {
			const previous = messages.at(-1);
			if (!previous) throw new Error(m.templates_paste_invalid());
			previous.text += `\n${line}`;
			continue;
		}
		const name = match[1].trim();
		let person = people.find(
			(person) => person.name.toLocaleLowerCase() === name.toLocaleLowerCase()
		);
		if (!person) {
			person = { id: crypto.randomUUID(), name };
			people.push(person);
		}
		messages.push({
			id: crypto.randomUUID(),
			sender_id: person.id,
			text: match[2]
		});
	}
	if (
		!messages.length ||
		messages.length > 80 ||
		people.length > 12 ||
		messages.some((message) => message.text.length > 2000)
	)
		throw new Error(m.templates_paste_invalid());
	return { ...conversation, people, messages };
}
