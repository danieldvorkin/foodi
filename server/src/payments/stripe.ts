import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PaymentProvider } from './types.js';

interface StripeOpts {
  secretKey: string;
  webhookSecret: string | null;
  apiBase: string;
}

/** Form-encodes nested objects the way Stripe's API expects (a[b][c]=v). */
function encode(obj: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => out.push(...(typeof item === 'object' ? encode(item as Record<string, unknown>, `${key}[${i}]`) : [`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`])));
    else if (typeof v === 'object') out.push(...encode(v as Record<string, unknown>, key));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}

/**
 * Stripe Checkout over plain fetch — no SDK. One-time payments only; the webhook tells us when
 * a session is paid. Refunds go through the session's payment intent.
 */
export function createStripeProvider(opts: StripeOpts): PaymentProvider {
  async function call<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${opts.apiBase}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${opts.secretKey}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: encode(body).join('&'),
    });
    const json = (await res.json()) as T & { error?: { message?: string } };
    if (!res.ok) throw new Error(`Stripe: ${json.error?.message ?? res.status}`);
    return json;
  }

  return {
    id: 'stripe',
    async createCheckout(input) {
      const session = await call<{ id: string; url: string }>('/v1/checkout/sessions', {
        mode: 'payment',
        client_reference_id: input.refId,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        customer_email: input.customerEmail ?? undefined,
        line_items: [{ quantity: 1, price_data: { currency: input.currency, unit_amount: input.amountCents, product_data: { name: input.name, description: input.description } } }],
        metadata: { kind: input.kind, refId: input.refId },
      });
      return { url: session.url, providerRef: session.id };
    },
    async refund(providerRef) {
      // providerRef is a Checkout Session id; refunds want the payment intent behind it.
      const res = await fetch(`${opts.apiBase}/v1/checkout/sessions/${encodeURIComponent(providerRef)}`, { headers: { authorization: `Bearer ${opts.secretKey}` } });
      const session = (await res.json()) as { payment_intent?: string; error?: { message?: string } };
      if (!res.ok || !session.payment_intent) throw new Error(`Stripe: ${session.error?.message ?? 'no payment intent on that session'}`);
      await call('/v1/refunds', { payment_intent: session.payment_intent });
    },
  };
}

/**
 * Verify a Stripe webhook signature (`t=…,v1=…` header, HMAC-SHA256 of `${t}.${body}`).
 * Returns the parsed event or null. Tolerates 5 minutes of clock skew.
 */
export function verifyStripeWebhook(rawBody: Buffer, header: string | undefined, secret: string, nowMs = Date.now()): { type: string; data: { object: Record<string, unknown> } } | null {
  if (!header) return null;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = parts['t'];
  const v1 = parts['v1'];
  if (!t || !v1 || Math.abs(nowMs / 1000 - Number(t)) > 300) return null;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody.toString('utf8')}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(rawBody.toString('utf8')) as { type: string; data: { object: Record<string, unknown> } };
  } catch {
    return null;
  }
}
