export type CheckoutKind = 'book' | 'promo';

export interface CheckoutInput {
  kind: CheckoutKind;
  /** Our purchase or promotion id; comes back in the webhook / return URL. */
  refId: string;
  amountCents: number;
  currency: string;
  name: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail: string | null;
}

export interface PaymentProvider {
  id: 'stripe' | 'test';
  /** Start a hosted checkout. The person is redirected to `url`; we hear back via webhook (Stripe) or the test page. */
  createCheckout(input: CheckoutInput): Promise<{ url: string; providerRef: string }>;
  /** Best effort refund of a completed payment. Throws if the provider refuses. */
  refund(providerRef: string): Promise<void>;
}
