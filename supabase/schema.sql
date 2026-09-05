-- ============================================================================
-- Razorpay AI Buildathon 2026: AI Revenue Recovery Track
-- Database Schema for Payment Recovery Agent
-- ============================================================================

-- Enable UUID extension if not enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. CUSTOMERS TABLE
-- Tracks customer identity, aggregate failure/recovery telemetry, and opt-out state
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(20) NOT NULL UNIQUE,
    email VARCHAR(255),
    total_failed INTEGER DEFAULT 0,
    total_recovered INTEGER DEFAULT 0,
    do_not_contact BOOLEAN DEFAULT FALSE,
    opted_out_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_do_not_contact ON customers(do_not_contact);

-- 2. TRANSACTIONS TABLE
-- Ingested failed payments and checkout drop-offs with recovery status & scores
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    razorpay_payment_id VARCHAR(100) UNIQUE,
    razorpay_order_id VARCHAR(100),
    amount NUMERIC(12, 2) NOT NULL, -- In INR (e.g. 1499.00)
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    channel VARCHAR(50) DEFAULT 'checkout_web', -- 'checkout_web', 'upi_app', 'payment_link', 'mobile_sdk'
    failure_reason_raw TEXT NOT NULL,
    failure_bucket VARCHAR(50) NOT NULL CHECK (
        failure_bucket IN (
            'card_decline',
            'upi_timeout',
            'network_error',
            'cart_abandon',
            'insufficient_funds',
            'other'
        )
    ),
    recoverability_score INTEGER NOT NULL CHECK (recoverability_score BETWEEN 0 AND 100),
    score_breakdown JSONB DEFAULT '{}'::jsonb,
    status VARCHAR(50) NOT NULL DEFAULT 'failed' CHECK (
        status IN (
            'failed',
            'in_recovery',
            'recovered',
            'escalated_human_review',
            'unrecoverable',
            'opted_out'
        )
    ),
    retry_payment_link TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_customer_id ON transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_failure_bucket ON transactions(failure_bucket);
CREATE INDEX IF NOT EXISTS idx_transactions_score ON transactions(recoverability_score DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);

-- 3. RECOVERY ATTEMPTS TABLE
-- Audit log of bounded outreach attempts with timestamp tracking for 6-hr cooldown
CREATE TABLE IF NOT EXISTS recovery_attempts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL CHECK (attempt_number BETWEEN 1 AND 3),
    channel VARCHAR(50) NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp', 'sms')),
    message_sent TEXT NOT NULL,
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    outcome VARCHAR(50) NOT NULL DEFAULT 'sent' CHECK (
        outcome IN (
            'sent',
            'delivered',
            'read',
            'clicked',
            'recovered',
            'opted_out',
            'failed_escalated'
        )
    ),
    retry_payment_link TEXT NOT NULL,
    llm_model_used VARCHAR(100),
    guardrail_checks JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_recovery_attempts_transaction ON recovery_attempts(transaction_id);
CREATE INDEX IF NOT EXISTS idx_recovery_attempts_sent_at ON recovery_attempts(sent_at DESC);

-- 4. HUMAN ESCALATIONS TABLE
-- Escalation queue for transactions that reached 3 attempts or triggered safety reviews
CREATE TABLE IF NOT EXISTS human_escalations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    reason VARCHAR(100) NOT NULL, -- 'max_attempts_reached', 'manual_request', 'high_ticket_dropoff'
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_review', 'resolved', 'closed')),
    assigned_to VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_human_escalations_status ON human_escalations(status);
