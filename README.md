# Razorpay Revenue Recovery Agent — AI Buildathon 2026

An autonomous, defensive AI Revenue Recovery Agent designed specifically for Indian e-commerce & SaaS merchants on **Razorpay**. 

The system continuously captures failed checkout telemetry, categorizes failure root causes into 6 canonical buckets (`upi_timeout`, `card_decline`, `network_error`, `cart_abandon`, `insufficient_funds`, `other`), computes an algorithmic **Recoverability Score (0–100)**, strictly enforces **5 hard-coded ethical guardrails**, and drives bounded, contextual **Hinglish** conversational outreach with authentic Razorpay Payment Links.

---

## What's Real vs Simulated in this Demo

To maintain total architectural honesty and technical transparency for hackathon evaluators, here is the exact breakdown of live integrations versus demo controls:

### 1. Live LLM Inference (100% Real)
- **Provider**: Groq Cloud API (`https://api.groq.com/openai/v1/chat/completions`).
- **Primary Model**: `qwen/qwen3.8-27b` (with fallback to `openai/gpt-oss-20b`).
- **Dynamic Context Injection**: Every recovery message is dynamically generated at runtime using the transaction's customer name, exact amount, failure bucket, raw telemetry error string (e.g., `"Beneficiary bank server down during MPIN authorization"` vs `"U30 switch busy"`), recoverability score, and attempt number.
- **No Fill-in-the-Blank Templates**: Each message is uniquely synthesized with distinct sentence structure, empathetic tone, and failure explanation.
- **Defensive Guardrail Post-Generation Check**: System prompt explicitly bans urgency patterns, and a post-generation regex validator actively checks for words like `"hurry"`, `"last chance"`, or `"offer expires"`, immediately rejecting and re-generating any violating message.

### 2. Live Razorpay Test-Mode Integration (100% Real API Endpoints)
The agent integrates directly with Razorpay's official REST API (`https://api.razorpay.com/v1`):
- **Payment Link Creation**: `POST https://api.razorpay.com/v1/payment_links` creates authentic Razorpay Payment Links with live short URLs (`https://rzp.io/...`) and unique IDs (`plink_...`).
- **Payment Link Status Polling**: `GET https://api.razorpay.com/v1/payment_links/:id` queries Razorpay's servers in real-time to check if the customer completed payment on the test checkout page (`status === "paid"`).
- **Webhook Ingestion & Cryptographic Verification**: `POST /api/webhooks/razorpay` receives live incoming webhook payloads (`payment.failed`, `payment_link.paid`, `order.paid`). It computes and verifies the `x-razorpay-signature` header using `crypto.createHmac('sha256', secret)` with `crypto.timingSafeEqual`, rejecting tampered requests with HTTP 400.
- **Honest Key Configuration**: When `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are present in `.env.local`, all payment links and status checks hit live Razorpay servers. If credentials have not yet been added, the UI clearly displays a yellow `[Simulated Link]` badge instead of silently pretending a mocked URL is live.

### 3. Agentic Decision-Making Engine (100% Real Computed Logic)
- **Cost-Aware Economic Send/No-Send Gate**:
  - Before any outreach is triggered, the agent evaluates unit economics:
    $$\text{Expected Value} = \frac{\text{Recoverability Score}}{100} \times \text{Transaction Amount}$$
    $$\text{Hurdle Threshold} = \text{Channel Message Cost (₹0.85 WhatsApp)} \times 3.0 \ (\text{Hurdle Rate}) = ₹2.55$$
  - If $\text{Expected Value} < ₹2.55$, the agent **skips outreach** and marks the transaction as `not_economically_viable` with full logged audit telemetry. This eliminates negative ROI messages and protects customers from low-value spam.
  - Rate source: Meta official WhatsApp Business Platform India conversation rate card (~₹0.82 marketing + BSP infrastructure markup). 3.0x hurdle rate ensures gross-margin profitability after cost of goods and gateway fees.
- **Root-Cause-Specific Remediation (No "One Retry Link Fits All")**:
  - `upi_timeout` & `network_error`: Transient issue $\rightarrow$ Direct instant 1-tap retry link on same payment method.
  - `insufficient_funds`: Balance/limit issue $\rightarrow$ Configures Razorpay payment link with Card EMI, PayLater, and alternate payment rails enabled so customer isn't trapped re-attempting a failing debit.
  - `cart_abandon`: Voluntary checkout exit $\rightarrow$ Sends transactional cart restoration link with item summary, omitting inaccurate "payment failed" copy while complying with transactional template rules.
  - `card_decline`: 3DS OTP/limit rejection $\rightarrow$ Prompts seamless fallback to 1-click Instant UPI (GPay/PhonePe).

### 4. TRAI / DLT Transactional Regulatory Compliance (Simulated Compliance Boundary)
- **Indian Regulatory Reality**: In production on Indian telecom and WhatsApp Business networks, automated commercial messages sent to Indian phone numbers cannot be arbitrary free-form LLM text. Under TRAI's Telecom Commercial Communications Customer Preference Regulations (TCCCPR), messages must be routed through pre-approved Distributed Ledger Technology (DLT) templates with fixed text and registered variable tokens (`{#var#}`), classified strictly as **Transactional / Service Implicit** to legally bypass customer Do-Not-Disturb (DND) filters and avoid telecom blocking.
- **Simulated Compliance Boundary in Demo**: The agent enforces this boundary algorithmically before any message is sent. An automated compliance classifier inspects the generated Hinglish message to guarantee it contains strictly **zero promotional language, marketing incentives, discount coupons, or artificial urgency triggers**. Each successfully dispatched message is tagged and stored with `message_category: "transactional"`. In production, this generated content would map directly to registered DLT template variables rather than direct transmission.

### 5. Explainable Historical Telemetry & Recurring Failure Patterns (Rule-Based, NOT Black-Box ML)
- **Transparent Rule**: Evaluates each customer's checkout history: if a customer has $\ge 2$ past transactions failing in the same failure bucket (e.g. 2 prior `upi_timeout` events), they are flagged with explainable telemetry.
- **Strictly Non-Black-Box**: No opaque synthetic "ML risk prediction scores" or fictional checkout-prevention claims. Every flag is fully traceable to transparent counts (e.g. *"3 of 3 checkout attempts failed with UPI Network Timeout"*).
- **Dashboard Telemetry Panel**: A dedicated **"Customers with Recurring Failure Patterns"** panel displays flagged customers, repeated bucket badges, failure counts, and actionable root-cause troubleshooting recommendations (e.g. updating GPay/PhonePe or switching to Netbanking rails).
- **Context-Aware LLM Outreach**: When an outreach message is generated for a repeat-failure customer, the LLM prompt is injected with their historical failure telemetry. The AI acknowledges the repeat issue with empathy and provides concrete troubleshooting advice rather than generic retry copy.

### 6. Demo Accommodations (Clearly Disclosed)
- **6-Hour Cooldown Fast-Forward**: In production, Guardrail 4 strictly blocks sending a follow-up message if fewer than 6 hours have elapsed since the previous attempt. For demo and judging purposes, a **"Fast-forward 6h (Demo)"** button sets the previous attempt's timestamp to 7 hours ago so evaluators can inspect attempt #2 and attempt #3 without waiting 6 real hours. The underlying production guardrail logic (`evaluateRecoveryGuardrails`) checks real millisecond elapsed time.
- **Synthetic Historical Dataset**: The initial seed button populates realistic failed transactions across the 6 failure buckets to provide immediate analytics, funnel breakdowns, and human escalation queue entries for demonstration.
- **Test Mode Payment Resolution**: Evaluators can click the live Razorpay short link to pay using Razorpay test credentials, or use the **"Verify on Razorpay API"** / **"Complete Payment (Recover)"** buttons to test state transitions.
- **Payment-State Re-Verification (Simulated State Log)**: Payment-state re-verification uses a simulated state log for this demo; in production this would call Razorpay's live payment status API (`GET /v1/payments/:id`). If a late authorization resolves on the banking switch, outreach is cancelled and marked as `Auto-Resolved (Late Capture)`.

---

## Key Architecture & Guardrails

The agent enforces **5 Non-Negotiable Hard Guardrails** before any recovery action can execute:
1. **Cost-Aware Economic Gate**: Expected value must exceed 3.0x messaging cost ($EV \ge ₹2.55$).
2. **Opt-Out Compliance**: If customer replies `"STOP"` / `"NO"` or is flagged `do_not_contact`, all future outreach is permanently blocked.
3. **Resolved / In-Review Protection**: No messages can be sent to transactions already marked `recovered`, `not_economically_viable`, or `escalated_human_review`.
4. **Strict Attempt Limit**: Maximum of 3 attempts ever. Exceeding 3 automatically routes the transaction to the L2 Human Review Queue.
5. **Mandatory 6-Hour Cooldown**: Prevents customer harassment with enforced minimum gap between touchpoints.
6. **Anti-Dark Pattern Tone Filter**: Prohibits false scarcity, countdown timers, fake urgency, and legal threats. Mandatory opt-out disclaimer appended.
7. **DPDP Act Customer PII Masking**: Reflects India's Digital Personal Data Protection (DPDP) Act principles for appropriate customer PII handling — phone numbers are masked by default across dashboard feeds (`+91 987****210`) and logs, unmasking only within the expanded inspection drawer for verified L2 operational needs (without overclaiming full statutory compliance).
8. **Payment Link Creation Idempotency**: Before calling Razorpay APIs, derives a deterministic key `idem_{transaction_id}_att_{attempt_number}` to cache and deduplicate requests, preventing redundant payment link creation during race conditions or rapid double-clicks.
9. **Reconciliation Correctness & Lineage**: The `payment_link.paid` webhook handler resolves the original transaction record via `notes.transaction_id` and updates it in-place. No phantom transactions are created, ensuring the dashboard "Total Recovered" metric increments by exactly the single transaction amount without double-counting.
10. **Mass-Failure Systemic Circuit Breaker**: If $\ge 10$ failures occur in the same failure bucket within a 15-minute rolling window, automated outreach for that bucket is immediately paused and a systemic alert banner is surfaced on the dashboard. This prevents burning messaging fees during bank core-banking switch outages (e.g. HDFC CBS/NPCI downtime).

---

## Environment Variables Setup

Create or update `.env.local`:

```bash
# Groq LLM API Key (Required for live Hinglish message generation)
GROQ_API_KEY=gsk_...

# Razorpay Test Mode Credentials (Required for live rzp.io links & live status verification)
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...

# Razorpay Webhook Secret (Required for live HMAC-SHA256 signature verification)
RAZORPAY_WEBHOOK_SECRET=rzp_test_webhook_secret_dev_2026
```

---

## Production-Maturity Verification Test Suite

Run these deterministic verification scripts to validate each production-grade check:

### 1. Transactional Message Compliance (TRAI DLT)
Validates that generated recovery copy strictly excludes promotional keywords (discounts, coupons, limited time) and stores `message_category: "transactional"`:
```bash
npx tsx scripts/verify-dlt-compliance.ts
```

### 2. Reconciliation Correctness & Lineage
Seeds a failed transaction, generates a retry link, fires a `payment_link.paid` webhook, and verifies the original record updates in-place with zero double-counting:
```bash
npx tsx scripts/verify-reconciliation.ts
```

### 3. Payment Link Creation Idempotency
Triggers rapid duplicate recovery link calls for the same transaction and verifies identical link IDs/URLs are returned without duplicate creation:
```bash
npx tsx scripts/verify-idempotency.ts
```

### 4. DPDP Act PII Masking in Display & Logs
Tests telephone and email masking across dashboard tables and server logs while ensuring raw operational data remains intact in database storage:
```bash
npx tsx scripts/verify-pii-masking.ts
```

### 5. Mass-Failure Systemic Circuit Breaker
Seeds a burst of 10 `upi_timeout` failures within a 15-minute window and verifies that automated recovery is strictly gated (`CIRCUIT_BREAKER_TRIPPED`) and an alert is surfaced:
```bash
npx tsx scripts/verify-circuit-breaker.ts
```

---

## Advanced Production-Realistic Depth (Tasks 1–5)

To make automated recovery decisions defensible, explainable, and compliant with banking realities:

### Task 1: Payment-State Re-Verification (Late Capture Detection)
- **Problem**: In Indian UPI and card switches, failed transactions can resolve 15–30 minutes later via late authorization or batch reconciliation. Blindly sending recovery outreach risks double-charging customers or causing frustration.
- **Solution**: Before generating any outreach, the agent verifies `payment_state_log`. If status flipped to `captured`, outreach is cancelled and marked `Auto-Resolved (Late Capture)`.
- *Note*: Uses a simulated state log for this demo; in production this would call Razorpay's live payment status API (`GET /v1/payments/:id`).
```bash
npx tsx scripts/verify-late-capture.ts
```

### Task 2: Explainable Additive Recoverability Scoring
- **Problem**: Single black-box scores with vague bullet points undermine merchant trust.
- **Solution**: Replaced vague text with a real additive mathematical breakdown (+25 Payment Initiated, +20 Transient Reason, +15 Order Value Tier, +10 Attempt History, -10 Repeat Failure Penalty = Total Score) computed directly from transaction fields in code.
```bash
npx tsx scripts/verify-scoring-breakdown.ts
```

### Task 3: PII Badge + Authentic Timestamped Audit Trail
- **Problem**: Static labels or synthetic timestamps fail regulatory inspection.
- **Solution**: Phone numbers default to "🔒 PII Protected" with transient 8-second unmasking. Inspection view renders a 5-step chronological audit trail derived from genuine transaction lifecycle timestamps.
```bash
npx tsx scripts/verify-audit-trail.ts
```

### Task 4: Bucket-Specific Configurable Cooldown Policies
- **Problem**: A flat 6-hour cooldown ignores root cause realities (transient network drops vs balance shortages).
- **Solution**: Enforces bucket-specific cooldown policies with operational rationales:
  - `upi_timeout`: 45 min cooldown (transient; customer likely has phone in hand).
  - `network_error`: 30 min cooldown (rapid network recovery).
  - `insufficient_funds`: 12h cooldown, strictly capped at 1 attempt (prevents customer harassment).
  - `cart_abandon`: 2h cooldown, capped at 2 attempts (gives purchase intent time to resurface).
  - `card_decline`: 2h cooldown (allows card re-activation or alternate rail).
```bash
npx tsx scripts/verify-bucket-cooldowns.ts
```

### Task 5: End-to-End Recovery Funnel with Attribution
- **Problem**: Treating "Recovered" as a single toggle disconnects revenue from the customer journey.
- **Solution**: Tracks the full 4-stage funnel: `Messaged` → `Link Clicked` → `Payment Retried` → `Payment Successful` (Attributed). Demo buttons allow testing Link Click and Payment Retry simulations, computing exact CTR, Retry Rate, Conversion Rate, and Attributed Recovered Revenue.
```bash
npx tsx scripts/verify-attribution-funnel.ts
```

---

## Core Feature Verification Scripts

### 6. Live LLM Hinglish Generation & Anti-Urgency Guardrails
```bash
npx tsx scripts/test-llm-hinglish.ts
```

### 7. Razorpay Webhook Signature & Lifecycle
```bash
npx tsx scripts/test-razorpay-webhook.ts
```

### 8. Cost-Aware Decision Gate & Root-Cause Remediation
```bash
npx tsx scripts/verify-agentic-decisions.ts
```

### 9. Recurring Failure Pattern Detection
```bash
npx tsx scripts/verify-recurring-patterns.ts
```

### 10. Defensive Guardrail Suite
```bash
npx tsx scripts/verify-guardrails.ts
```

---

## Running Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to access the interactive dashboard.

