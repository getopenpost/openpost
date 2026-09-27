<script lang="ts">
	import { getAuthenticatedMediaByID } from '$lib/media-url';
	import { m } from '$lib/paraglide/messages';
	import type { ScreenshotDocument } from '@openpost/query-catalog';
	import { receiptMoney, receiptTotals, TEMPLATE_WIDTH } from './document';
	let {
		document: doc,
		element = $bindable(),
		contentElement = $bindable(),
		onselect
	}: {
		document: ScreenshotDocument;
		element?: HTMLDivElement;
		contentElement?: HTMLDivElement;
		onselect?: (id: string) => void;
	} = $props();
	let chat = $derived(doc.conversation);
	let receipt = $derived(doc.receipt);
	let status = $derived(doc.status_page);
	let messages = $derived(chat?.messages ?? []);
	let totals = $derived(receipt ? receiptTotals(receipt) : null);
	let fontSize = $derived(doc.text_size === 'small' ? 19 : doc.text_size === 'large' ? 27 : 23);
</script>

<div
	bind:this={element}
	class="screenshot"
	class:dark={doc.appearance === 'dark'}
	data-template-preview={doc.template_id}
	style:width="{TEMPLATE_WIDTH}px"
	style:font-size="{fontSize}px"
	style:min-height={doc.frame === 'square'
		? '540px'
		: doc.frame === 'portrait'
			? '675px'
			: undefined}
>
	<div bind:this={contentElement}>
		{#if chat}
			{#if chat.show_header}
				<div class="chat-header">
					<span class="back" aria-hidden="true">‹</span>
					<div class="contact">
						{#if doc.template_id === 'group-chat'}
							<div class="group-avatars">
								{#each chat.people.slice(0, 4) as person (person.id)}
									<div class="avatar">
										{#if person.avatar_media_id}<img
												src={getAuthenticatedMediaByID(person.avatar_media_id)}
												alt={person.name}
											/>{:else}{person.name.slice(0, 1).toUpperCase()}{/if}
									</div>
								{/each}{#if chat.people.length > 4}<span class="avatar-count"
										>+{chat.people.length - 4}</span
									>{/if}
							</div>
						{:else}
							{@const contact = chat.people.find((person) => person.id !== chat.self_id)}
							<div class="avatar">
								{#if contact?.avatar_media_id}<img
										src={getAuthenticatedMediaByID(contact.avatar_media_id)}
										alt={contact.name}
									/>{:else}{chat.name
										.split(/\s+/)
										.map((word) => word.charAt(0))
										.slice(0, 2)
										.join('')
										.toUpperCase()}{/if}
							</div>
						{/if}
						<div class="contact-name">{chat.name} <span class="chevron">›</span></div>
					</div>
					<svg
						class="video"
						width="36"
						height="30"
						viewBox="0 0 36 30"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						aria-hidden="true"
						><rect x="1.5" y="4" width="23" height="22" rx="5" /><path
							d="m25 11 9-6v20l-9-6z"
						/></svg
					>
				</div>
			{/if}
			<div class="chat-body">
				{#if chat.timestamp}<div class="timestamp">{chat.timestamp}</div>{/if}
				{#each messages as message, index (message.id)}
					{@const outgoing = message.sender_id === chat.self_id}
					{@const grouped = index > 0 && messages[index - 1].sender_id === message.sender_id}
					{@const sender = chat.people.find((person) => person.id === message.sender_id)}
					{@const last = messages[index + 1]?.sender_id !== message.sender_id}
					<div
						class="message"
						class:outgoing
						class:grouped
						class:with-avatar={Boolean(sender?.avatar_media_id)}
						data-content-id={message.id}
					>
						{#if sender?.avatar_media_id && last}<img
								class="message-avatar"
								src={getAuthenticatedMediaByID(sender.avatar_media_id)}
								alt={sender.name}
							/>{/if}
						{#if doc.template_id === 'group-chat' && !outgoing && !grouped}<div class="sender">
								{chat.people?.find((person) => person.id === message.sender_id)?.name}
							</div>{/if}
						<svelte:element
							this={onselect ? 'button' : 'div'}
							role={onselect ? 'button' : undefined}
							type={onselect ? 'button' : undefined}
							class="bubble"
							class:tail={last && !message.image_media_id}
							class:photo-bubble={Boolean(message.image_media_id)}
							dir="auto"
							onclick={() => onselect?.(message.id)}
						>
							{#if message.image_media_id}<img
									class="message-image"
									src={getAuthenticatedMediaByID(message.image_media_id)}
									alt={m.templates_message_photo({ number: index + 1 })}
								/>{/if}
							{#if message.text || !message.image_media_id}<span class="message-text"
									>{message.text || '\u00a0'}</span
								>{/if}
						</svelte:element>
					</div>
				{/each}
				{#if chat.read_receipt && messages.at(-1)?.sender_id === chat.self_id}<div
						class="read-receipt"
					>
						{chat.read_receipt}
					</div>{/if}
			</div>
		{:else if receipt && totals}
			<div class="receipt">
				<div class="receipt-heading">
					<strong>{receipt.business}</strong>
					<p>{receipt.address}</p>
					<p>{receipt.timestamp}</p>
					{#if receipt.order}<p>{receipt.order}</p>{/if}
				</div>
				<div class="receipt-rule"></div>
				{#each receipt.items ?? [] as item (item.id)}<div
						class="receipt-row"
						data-content-id={item.id}
					>
						<span>{item.quantity} {item.name}</span><span
							>{receiptMoney(item.quantity * item.amount_cents, receipt.currency)}</span
						>
					</div>{/each}
				<div class="receipt-rule"></div>
				<div class="receipt-row">
					<span>Subtotal</span><span>{receiptMoney(totals.subtotal, receipt.currency)}</span>
				</div>
				<div class="receipt-row">
					<span>Tax ({receipt.tax_percent}%)</span><span
						>{receiptMoney(totals.tax, receipt.currency)}</span
					>
				</div>
				<div class="receipt-row total">
					<strong>Total</strong><strong
						>{receipt.custom_total || receiptMoney(totals.total, receipt.currency)}</strong
					>
				</div>
				<div class="receipt-rule"></div>
				<div class="receipt-footer">{receipt.footer}</div>
			</div>
		{:else if status}
			<div class="status-page">
				<header>
					<strong>{status.name}</strong><span class="subscribe">Subscribe to updates</span>
				</header>
				<div
					class="incident"
					class:outage={status.severity === 'outage'}
					class:operational={status.severity === 'operational'}
				>
					<h2>{status.headline}</h2>
					<div class="updates">
						{#each status.updates ?? [] as update (update.id)}<div
								class="update"
								data-content-id={update.id}
							>
								<p><strong>{update.stage}</strong> · {update.text}</p>
								<div class="update-time">{update.timestamp}</div>
							</div>{/each}
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		border-radius: inherit;
	}
	.group-avatars {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 65px;
		padding-inline: 8px;
	}
	.group-avatars .avatar {
		width: 45px;
		height: 45px;
		font-size: 22px;
		border: 2px solid var(--shot-panel);
		margin-inline: -8px;
	}
	.avatar-count {
		font-size: 13px;
		margin-left: 12px;
	}
	.message {
		position: relative;
	}
	.message.with-avatar {
		padding-left: 44px;
	}
	.message.with-avatar.outgoing {
		padding-left: 0;
		padding-right: 44px;
	}
	.message-avatar {
		position: absolute;
		left: 0;
		bottom: 0;
		width: 29px;
		height: 29px;
		border-radius: 50%;
		object-fit: cover;
	}
	.outgoing .message-avatar {
		left: auto;
		right: 0;
	}
	.bubble.photo-bubble {
		white-space: normal;
		padding: 0;
		overflow: hidden;
		width: 300px;
	}
	.message-image {
		display: block;
		width: 100%;
		height: auto;
		max-height: 380px;
		object-fit: contain;
	}
	.photo-bubble .message-text {
		white-space: pre-wrap;
		display: block;
		padding: 11px 17px;
	}

	.screenshot {
		--shot-bg: #fff;
		--shot-text: #111;
		--shot-muted: #71717a;
		--shot-panel: #f4f4f5;
		--shot-bubble: #e9e9eb;
		background: var(--shot-bg);
		color: var(--shot-text);
		font-family: Arial, Helvetica, sans-serif;
		line-height: 1.24;
		box-sizing: border-box;
		flex-shrink: 0;
		overflow-wrap: anywhere;
		color-scheme: light;
		text-align: left;
	}
	.screenshot.dark {
		--shot-bg: #000;
		--shot-text: #fff;
		--shot-muted: #a1a1aa;
		--shot-panel: #191919;
		--shot-bubble: #28282a;
		color-scheme: dark;
	}
	.chat-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 17px 26px 12px;
		background: var(--shot-panel);
		border-bottom: 1px solid #b5b5b555;
		gap: 16px;
	}
	.contact {
		display: flex;
		align-items: center;
		flex-direction: column;
		gap: 7px;
		min-width: 0;
	}
	.contact-name {
		font-size: 18px;
		text-align: center;
	}
	.avatar {
		width: 65px;
		height: 65px;
		border-radius: 50%;
		background: #969ba6;
		color: #fff;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 29px;
	}
	.back {
		font-size: 55px;
		font-weight: 300;
		color: #007aff;
	}
	.video {
		color: #007aff;
		flex-shrink: 0;
	}
	.chevron {
		color: #96969c;
	}
	.chat-body {
		padding: 20px 22px 26px;
	}
	.timestamp {
		text-align: center;
		color: var(--shot-muted);
		font-size: 17px;
		margin: 0 0 19px;
	}
	.message {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		margin-top: 13px;
	}
	.message.grouped {
		margin-top: 4px;
	}
	.message.outgoing {
		align-items: flex-end;
	}
	.bubble {
		display: block;
		border: 0;
		text-align: start;
		font: inherit;
		color: inherit;
		position: relative;
		border-radius: 24px;
		padding: 11px 17px;
		max-width: 82%;
		background: var(--shot-bubble);
		white-space: pre-wrap;
		min-width: 32px;
		isolation: isolate;
	}
	.bubble:focus-visible {
		outline: 2px solid #007aff;
		outline-offset: 4px;
	}
	.outgoing .bubble {
		background: #007aff;
		color: #fff;
	}
	.tail:before {
		content: '';
		position: absolute;
		z-index: -1;
		bottom: 0;
		left: -7px;
		width: 22px;
		height: 21px;
		border-radius: 0 0 18px 0;
		background: var(--shot-bubble);
	}
	.tail:after {
		content: '';
		position: absolute;
		z-index: -1;
		bottom: 0;
		left: -13px;
		width: 13px;
		height: 23px;
		border-radius: 0 0 13px 0;
		background: var(--shot-bg);
	}
	.outgoing .tail:before {
		left: auto;
		right: -7px;
		border-radius: 0 0 0 18px;
		background: #007aff;
	}
	.outgoing .tail:after {
		left: auto;
		right: -13px;
		border-radius: 0 0 0 13px;
	}
	.sender {
		font-size: 14px;
		color: var(--shot-muted);
		padding: 0 15px 4px;
	}
	.read-receipt {
		text-align: right;
		color: var(--shot-muted);
		font-size: 14px;
		margin-top: 7px;
	}
	.receipt {
		font-family: 'Courier New', monospace;
		padding: 38px 30px;
		font-size: 0.8em;
		line-height: 1.5;
	}
	.receipt-heading {
		text-align: center;
		white-space: pre-wrap;
	}
	.receipt-heading strong {
		font-size: 1.3em;
	}
	.receipt-heading p {
		margin: 15px 0;
	}
	.receipt-rule {
		border-top: 2px dashed currentColor;
		margin: 25px 0;
	}
	.receipt-row {
		display: flex;
		justify-content: space-between;
		gap: 18px;
		margin: 13px 0;
	}
	.receipt-row span:last-child {
		flex-shrink: 0;
	}
	.receipt-row.total {
		font-size: 1.5em;
		margin-top: 23px;
		flex-wrap: wrap;
	}
	.receipt-footer {
		text-align: center;
		white-space: pre-wrap;
	}
	.status-page {
		padding: 32px 25px;
		font-size: 0.7em;
		line-height: 1.5;
	}
	.status-page header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		margin-bottom: 46px;
	}
	.status-page header strong {
		font-size: 1.6em;
	}
	.subscribe {
		flex-shrink: 0;
		background: var(--shot-text);
		color: var(--shot-bg);
		padding: 8px;
		font-size: 9px;
		letter-spacing: 0.6px;
		text-transform: uppercase;
		border-radius: 3px;
	}
	.incident {
		--incident: #ad4610;
		border: 1px solid var(--incident);
	}
	.incident.outage {
		--incident: #bd252c;
	}
	.incident.operational {
		--incident: #247148;
	}
	.incident h2 {
		font-size: 1.2em;
		background: var(--incident);
		color: white;
		font-weight: 600;
		margin: 0;
		padding: 14px 16px;
	}
	.updates {
		padding: 17px 16px;
	}
	.update + .update {
		margin-top: 24px;
	}
	.update p {
		margin: 0;
		white-space: pre-wrap;
	}
	.update-time {
		color: var(--shot-muted);
		margin-top: 5px;
		font-size: 0.86em;
	}
</style>
