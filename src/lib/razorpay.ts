import crypto from 'crypto';

export interface CreatePaymentLinkParams {
  amount: number; // in INR
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  description: string;
  transactionId: string;
  attemptNumber?: number;
  idempotencyKey?: string;
  notes?: Record<string, string>;
}

export interface RazorpayPaymentLinkResponse {
  id: string; // e.g. plink_xxx
  short_url: string; // e.g. https://rzp.io/i/xxxxxx
  status: 'created' | 'partially_paid' | 'paid' | 'cancelled' | 'expired';
  amount: number; // in paise
  amount_paid: number;
  customer?: {
    name?: string;
    email?: string;
    contact?: string;
  };
  payments?: Array<{
    payment_id: string;
    amount: number;
    status: string;
    method?: string;
    created_at?: number;
  }>;
  raw?: any;
}

export class RazorpayClient {
  private keyId: string;
  private keySecret: string;
  private isConfigured: boolean;
  private idempotencyRegistry = new Map<
    string,
    { link: RazorpayPaymentLinkResponse; isSimulated: boolean }
  >();

  constructor() {
    this.keyId = process.env.RAZORPAY_KEY_ID?.trim() || '';
    this.keySecret = process.env.RAZORPAY_KEY_SECRET?.trim() || '';
    this.isConfigured = Boolean(this.keyId && this.keySecret);
  }

  public hasValidCredentials(): boolean {
    return this.isConfigured;
  }

  public getStatus() {
    return {
      configured: this.isConfigured,
      keyIdPrefix: this.keyId ? this.keyId.substring(0, 8) + '...' : null,
      mode: this.keyId.startsWith('rzp_live') ? 'live' : 'test',
    };
  }

  private getAuthHeader(): string {
    const credentials = `${this.keyId}:${this.keySecret}`;
    return `Basic ${Buffer.from(credentials).toString('base64')}`;
  }

  /**
   * Creates an authentic Razorpay Payment Link via the official REST API
   * POST https://api.razorpay.com/v1/payment_links
   */
  public async createPaymentLink(
    params: CreatePaymentLinkParams
  ): Promise<{ link: RazorpayPaymentLinkResponse | null; isSimulated: boolean; error?: string }> {
    // Derive unique idempotency key: (transaction_id + attempt_number)
    const derivedKey =
      params.idempotencyKey ||
      (params.attemptNumber
        ? `idem_${params.transactionId}_att_${params.attemptNumber}`
        : `idem_${params.transactionId}`);

    // Check in-memory idempotency registry
    if (this.idempotencyRegistry.has(derivedKey)) {
      console.log(
        `[Idempotency] Intercepted duplicate payment link creation for key "${derivedKey}". Returning existing link.`
      );
      return this.idempotencyRegistry.get(derivedKey)!;
    }

    if (!this.isConfigured) {
      // Honestly disclose when credentials are not yet supplied
      const simResult = {
        link: {
          id: `plink_sim_${derivedKey.replace(/[^a-zA-Z0-9_]/g, '')}`,
          short_url: `https://rzp.io/i/sim_${params.transactionId.replace(/^tx_/, '')}`,
          status: 'created' as const,
          amount: Math.round(params.amount * 100),
          amount_paid: 0,
        },
        isSimulated: true,
        error: 'RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET missing in .env.local',
      };
      this.idempotencyRegistry.set(derivedKey, simResult);
      return simResult;
    }

    try {
      // Amount in paise
      const amountInPaise = Math.round(params.amount * 100);

      const payload = {
        amount: amountInPaise,
        currency: 'INR',
        accept_partial: false,
        description: params.description.substring(0, 255),
        customer: {
          name: params.customerName,
          contact: params.customerPhone || '+919876543210',
          email: params.customerEmail || 'customer@example.com',
        },
        notify: {
          sms: false,
          email: false,
        },
        reminder_enable: false,
        notes: {
          system: 'razorpay_revenue_recovery_agent',
          transaction_id: params.transactionId,
          idempotency_key: derivedKey,
          created_at: new Date().toISOString(),
          ...(params.notes || {}),
        },
      };

      const res = await fetch('https://api.razorpay.com/v1/payment_links', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.getAuthHeader(),
          'X-Payout-Idempotency': derivedKey,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        console.error('[Razorpay API Error createPaymentLink]:', data);
        return {
          link: null,
          isSimulated: false,
          error: data?.error?.description || `Razorpay API HTTP ${res.status}`,
        };
      }

      const result = {
        link: {
          id: data.id,
          short_url: data.short_url,
          status: data.status,
          amount: data.amount,
          amount_paid: data.amount_paid || 0,
          customer: data.customer,
          raw: data,
        },
        isSimulated: false,
      };

      // Store in idempotency registry for subsequent deduplication
      this.idempotencyRegistry.set(derivedKey, result);
      return result;
    } catch (err: any) {
      console.error('[Razorpay Network Error createPaymentLink]:', err);
      return {
        link: null,
        isSimulated: false,
        error: err?.message || 'Network failure communicating with Razorpay API',
      };
    }
  }

  /**
   * Fetches real-time status of a Payment Link directly from Razorpay
   * GET https://api.razorpay.com/v1/payment_links/:id
   */
  public async getPaymentLink(
    paymentLinkId: string
  ): Promise<{ link: RazorpayPaymentLinkResponse | null; isSimulated: boolean; error?: string }> {
    if (!this.isConfigured || paymentLinkId.startsWith('plink_sim_')) {
      return {
        link: null,
        isSimulated: true,
        error: 'Credentials not configured or simulated link ID',
      };
    }

    try {
      const res = await fetch(`https://api.razorpay.com/v1/payment_links/${paymentLinkId}`, {
        method: 'GET',
        headers: {
          Authorization: this.getAuthHeader(),
        },
      });

      const data = await res.json();

      if (!res.ok) {
        console.error('[Razorpay API Error getPaymentLink]:', data);
        return {
          link: null,
          isSimulated: false,
          error: data?.error?.description || `Razorpay API HTTP ${res.status}`,
        };
      }

      return {
        link: {
          id: data.id,
          short_url: data.short_url,
          status: data.status,
          amount: data.amount,
          amount_paid: data.amount_paid || 0,
          customer: data.customer,
          payments: data.payments || [],
          raw: data,
        },
        isSimulated: false,
      };
    } catch (err: any) {
      console.error('[Razorpay Network Error getPaymentLink]:', err);
      return {
        link: null,
        isSimulated: false,
        error: err?.message || 'Failed to query Razorpay API',
      };
    }
  }

  /**
   * Verifies Razorpay Webhook HMAC-SHA256 signature
   * Header: x-razorpay-signature
   */
  public verifyWebhookSignature(
    rawBody: string,
    signature: string,
    secret?: string
  ): { valid: boolean; reason?: string } {
    const webhookSecret = secret || process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!webhookSecret) {
      return {
        valid: false,
        reason: 'RAZORPAY_WEBHOOK_SECRET environment variable is not configured',
      };
    }

    if (!signature) {
      return {
        valid: false,
        reason: 'Missing x-razorpay-signature header',
      };
    }

    try {
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawBody)
        .digest('hex');

      const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
      const signatureBuffer = Buffer.from(signature, 'utf8');

      if (expectedBuffer.length !== signatureBuffer.length) {
        return { valid: false, reason: 'Signature length mismatch' };
      }

      const isValid = crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
      return { valid: isValid, reason: isValid ? undefined : 'HMAC SHA256 digest mismatch' };
    } catch (err: any) {
      return { valid: false, reason: `Verification error: ${err?.message}` };
    }
  }
}

export const razorpay = new RazorpayClient();
