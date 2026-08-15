import { createHmac } from "node:crypto";

const httpPort = Number(process.env.OPENPOST_APP_E2E_BOUNDARY_PORT ?? 18182);
const smtpPort = Number(process.env.OPENPOST_APP_E2E_SMTP_PORT ?? 18183);
const mastodonPort = Number(process.env.OPENPOST_APP_E2E_MASTODON_PORT ?? 18184);
const mastodonCert = process.env.OPENPOST_APP_E2E_MASTODON_CERT ?? "";
const mastodonKey = process.env.OPENPOST_APP_E2E_MASTODON_KEY ?? "";
const appURL = process.env.OPENPOST_APP_E2E_APP_URL ?? "http://127.0.0.1:18180";
const paddleWebhookSecret =
  process.env.OPENPOST_APP_E2E_PADDLE_WEBHOOK_SECRET ?? "e2e-paddle-webhook-secret";

const verificationCodes = new Map<string, string>();
const paddleSubscriptions = new Map<
  string,
  { checkoutID: string; email: string; priceID: string }
>();

function json(value: unknown, init: ResponseInit = {}) {
  return Response.json(value, init);
}

function stableID(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function bearer(request: Request) {
  return request.headers.get("authorization")?.replace(/^Bearer\s+/iu, "") ?? "";
}

function paddleSubscription(
  id: string,
  record: { checkoutID: string; email: string; priceID: string },
) {
  const now = new Date();
  const periodEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  return {
    id,
    status: "trialing",
    customer_id: `ctm_${stableID(record.email)}`,
    updated_at: now.toISOString(),
    custom_data: { checkout_id: record.checkoutID },
    current_billing_period: {
      starts_at: now.toISOString(),
      ends_at: periodEnd.toISOString(),
    },
    scheduled_change: null,
    items: [
      {
        recurring: true,
        quantity: 1,
        price: { id: record.priceID, product_id: "pro_founder" },
      },
    ],
  };
}

async function completePaddleCheckout(request: Request) {
  const input = (await request.json()) as {
    attempt_id?: string;
    email?: string;
    price_id?: string;
  };
  const checkoutID = input.attempt_id?.trim() ?? "";
  if (!checkoutID) return json({ error: "attempt_id is required" }, { status: 400 });
  const subscriptionID = `sub_${stableID(checkoutID)}`;
  paddleSubscriptions.set(subscriptionID, {
    checkoutID,
    email: input.email?.trim() || "first-use@example.com",
    priceID: input.price_id?.trim() || "pri_founder_annual",
  });
  const occurredAt = new Date().toISOString();
  const payload = JSON.stringify({
    event_id: `evt_${stableID(checkoutID)}`,
    event_type: "subscription.created",
    occurred_at: occurredAt,
    data: { id: subscriptionID },
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", paddleWebhookSecret)
    .update(`${timestamp}:${payload}`)
    .digest("hex");
  const response = await fetch(`${appURL}/api/v1/billing/paddle/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "paddle-signature": `ts=${timestamp};h1=${signature}`,
    },
    body: payload,
  });
  if (!response.ok) {
    return json({ error: await response.text() }, { status: 502 });
  }
  return json({ ok: true, subscription_id: subscriptionID });
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: httpPort,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("ok");
    if (url.pathname === "/__e2e/email-code") {
      const code = verificationCodes.get((url.searchParams.get("email") ?? "").toLowerCase());
      return code ? json({ code }) : json({ error: "not found" }, { status: 404 });
    }
    if (url.pathname === "/__e2e/paddle/complete" && request.method === "POST") {
      return completePaddleCheckout(request);
    }
    if (url.pathname === "/oauth/authorize") {
      const redirectURI = url.searchParams.get("redirect_uri");
      const state = url.searchParams.get("state");
      if (!redirectURI || !state) return new Response("invalid oauth request", { status: 400 });
      const target = new URL(redirectURI);
      target.searchParams.set("code", `code-${stableID(state)}`);
      target.searchParams.set("state", state);
      return Response.redirect(target, 302);
    }
    if (url.pathname === "/oauth/token" && request.method === "POST") {
      const form = new URLSearchParams(await request.text());
      const code = form.get("code") ?? "missing";
      return json({
        access_token: `token-${code}`,
        token_type: "Bearer",
        scope: "read write",
      });
    }
    if (url.pathname === "/api/v1/accounts/verify_credentials") {
      const token = bearer(request);
      return json({ id: `acct-${stableID(token)}`, acct: "openpost_e2e" });
    }
    if (url.pathname === "/api/v2/instance") {
      return json({
        version: "4.3.0-e2e",
        configuration: {
          statuses: { max_characters: 80, max_media_attachments: 4 },
          polls: {
            max_options: 4,
            max_characters_per_option: 25,
            min_expiration: 300,
            max_expiration: 86400,
          },
          media_attachments: {
            supported_mime_types: ["image/png", "image/jpeg"],
          },
        },
      });
    }
    if (url.pathname === "/api/v1/statuses" && request.method === "POST") {
      return json({ id: `status-${stableID(await request.text())}` });
    }
    const subscriptionMatch = url.pathname.match(/\/subscriptions\/(sub_[a-z0-9]+)$/u);
    if (subscriptionMatch) {
      const record = paddleSubscriptions.get(subscriptionMatch[1]);
      return record
        ? json({
            data: paddleSubscription(subscriptionMatch[1], record),
            meta: { request_id: "req_e2e" },
          })
        : json({ error: { code: "not_found", detail: "subscription not found" } }, { status: 404 });
    }
    const customerMatch = url.pathname.match(/\/customers\/(ctm_[a-z0-9]+)$/u);
    if (customerMatch) {
      const record = [...paddleSubscriptions.values()].find(
        (candidate) => `ctm_${stableID(candidate.email)}` === customerMatch[1],
      );
      return record
        ? json({
            data: {
              id: customerMatch[1],
              email: record.email,
              name: "OpenPost E2E",
            },
            meta: { request_id: "req_e2e" },
          })
        : json({ error: { code: "not_found", detail: "customer not found" } }, { status: 404 });
    }
    return new Response("not found", { status: 404 });
  },
});

const mastodon = Bun.serve({
  hostname: "127.0.0.1",
  port: mastodonPort,
  tls: {
    cert: Bun.file(mastodonCert),
    key: Bun.file(mastodonKey),
  },
  fetch(request) {
    const target = new URL(request.url);
    target.protocol = "http:";
    target.hostname = "127.0.0.1";
    target.port = String(httpPort);
    return fetch(new Request(target, request), { redirect: "manual" });
  },
});

type SMTPState = {
  buffer: string;
  data: string;
  recipient: string;
  readingData: boolean;
};
const smtpState = new WeakMap<object, SMTPState>();

function write(socket: { write(data: string): unknown }, line: string) {
  socket.write(`${line}\r\n`);
}

const smtp = Bun.listen({
  hostname: "127.0.0.1",
  port: smtpPort,
  socket: {
    open(socket) {
      smtpState.set(socket, {
        buffer: "",
        data: "",
        recipient: "",
        readingData: false,
      });
      write(socket, "220 openpost-e2e ESMTP");
    },
    data(socket, chunk) {
      const state = smtpState.get(socket);
      if (!state) return;
      state.buffer += chunk.toString();
      if (state.readingData) {
        const end = state.buffer.indexOf("\r\n.\r\n");
        if (end < 0) return;
        state.data += state.buffer.slice(0, end);
        state.buffer = state.buffer.slice(end + 5);
        const code = state.data.match(/\b([0-9]{6})\b/u)?.[1];
        if (code && state.recipient) verificationCodes.set(state.recipient.toLowerCase(), code);
        state.data = "";
        state.readingData = false;
        write(socket, "250 queued");
      }
      while (!state.readingData) {
        const newline = state.buffer.indexOf("\r\n");
        if (newline < 0) break;
        const line = state.buffer.slice(0, newline);
        state.buffer = state.buffer.slice(newline + 2);
        const command = line.toUpperCase();
        if (command.startsWith("EHLO") || command.startsWith("HELO")) {
          write(socket, "250-openpost-e2e");
          write(socket, "250 8BITMIME");
        } else if (command.startsWith("MAIL FROM:")) {
          write(socket, "250 ok");
        } else if (command.startsWith("RCPT TO:")) {
          state.recipient = line.match(/<([^>]+)>/u)?.[1] ?? line.slice(8).trim();
          write(socket, "250 ok");
        } else if (command === "DATA") {
          state.readingData = true;
          state.data = state.buffer;
          state.buffer = "";
          write(socket, "354 end with <CRLF>.<CRLF>");
          const end = state.data.indexOf("\r\n.\r\n");
          if (end >= 0) {
            state.buffer = state.data.slice(end + 5);
            state.data = state.data.slice(0, end);
            const code = state.data.match(/\b([0-9]{6})\b/u)?.[1];
            if (code && state.recipient) verificationCodes.set(state.recipient.toLowerCase(), code);
            state.data = "";
            state.readingData = false;
            write(socket, "250 queued");
          }
        } else if (command === "RSET") {
          state.recipient = "";
          write(socket, "250 ok");
        } else if (command === "QUIT") {
          write(socket, "221 bye");
          socket.end();
        } else {
          write(socket, "250 ok");
        }
      }
    },
    close(socket) {
      smtpState.delete(socket);
    },
    error(socket, error) {
      smtpState.delete(socket);
      process.stderr.write(`SMTP boundary error: ${error.message}\n`);
    },
  },
});

process.stdout.write(
  `OpenPost E2E boundaries listening on HTTP ${server.port}, HTTPS ${mastodon.port}, and SMTP ${smtp.port}\n`,
);
