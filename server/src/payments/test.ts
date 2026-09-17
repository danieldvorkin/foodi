import type { PaymentProvider } from './types.js';

/**
 * No real provider configured: checkout goes to an in-app page that says "test mode" in large
 * letters and completes or cancels the order with one click. Nothing is charged, ever.
 */
export function createTestProvider(appOrigin: string): PaymentProvider {
  return {
    id: 'test',
    async createCheckout(input) {
      return { url: `${appOrigin}/pay/test/${input.kind}/${encodeURIComponent(input.refId)}`, providerRef: `test_${input.refId}` };
    },
    async refund() {
      /* nothing was charged */
    },
  };
}
