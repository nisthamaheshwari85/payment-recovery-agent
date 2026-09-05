/**
 * Payment State Log (Simulated State Verification Registry)
 *
 * In real Indian payment systems (especially UPI and Netbanking), transactions that initially
 * report a timeout or pending state can resolve asynchronously via late authorization or
 * reconciliation batch capture at the bank switch (NPCI / CBS).
 *
 * In production, this module would invoke Razorpay's GET /v1/payments/:id endpoint to
 * check the authoritative live gateway state. For this demo, we maintain a simulated
 * payment state log to test this guardrail deterministically.
 */

export interface PaymentStateLogEntry {
  transaction_id: string;
  gateway_payment_id?: string;
  status: 'failed' | 'captured';
  verified_at: string;
  details?: string;
}

// In-memory / initial registry of payment state updates
const paymentStateLog: Map<string, PaymentStateLogEntry> = new Map([
  [
    'tx_demo_late_captured',
    {
      transaction_id: 'tx_demo_late_captured',
      gateway_payment_id: 'pay_late_cap_99881',
      status: 'captured',
      verified_at: new Date().toISOString(),
      details: 'Bank switch late-authorization captured (NPCI U30 cleared after client timeout)',
    },
  ],
  [
    'tx_demo_normal_failed',
    {
      transaction_id: 'tx_demo_normal_failed',
      gateway_payment_id: 'pay_norm_fail_11223',
      status: 'failed',
      verified_at: new Date().toISOString(),
      details: 'Confirmed permanent failure: insufficient funds on issuer card',
    },
  ],
]);

/**
 * Re-verifies payment state against the simulated payment state log.
 */
export function checkPaymentStateLog(transactionId: string): PaymentStateLogEntry {
  if (paymentStateLog.has(transactionId)) {
    return paymentStateLog.get(transactionId)!;
  }

  // Default: unlogged transactions remain in their recorded failed state
  return {
    transaction_id: transactionId,
    status: 'failed',
    verified_at: new Date().toISOString(),
    details: 'Initial failed status un-changed on gateway',
  };
}

/**
 * Register or update state in the payment state log (useful for tests and demo toggles)
 */
export function setPaymentStateLog(
  transactionId: string,
  status: 'failed' | 'captured',
  details?: string
): PaymentStateLogEntry {
  const entry: PaymentStateLogEntry = {
    transaction_id: transactionId,
    status,
    verified_at: new Date().toISOString(),
    details: details || (status === 'captured' ? 'Payment state flipped to captured via late auth' : 'Payment failed'),
  };
  paymentStateLog.set(transactionId, entry);
  return entry;
}
