# CCAvenue Payment Integration for B2B Credit Limit in AnPro LIMS

## 1. Core Understanding

In this model, **CCAvenue does not need to maintain separate B2B client accounts**.

All B2B client accounts, credit limits, outstanding balances, orders, ledger entries, and payment history will remain inside **AnPro LIMS**.

CCAvenue will only act as the **payment collection gateway** for the lab merchant.

## 2. Who Owns What?

### AnPro LIMS Owns

- Lab user account
- B2B client account
- B2B client login
- B2B client credit limit
- B2B client outstanding amount
- B2B client available credit
- Test order creation
- Invoice creation
- Payment requirement logic
- Credit ledger
- Payment reconciliation
- Order release after payment

### CCAvenue Owns

- Payment page
- Payment collection
- Transaction processing
- Payment success / failure response
- Merchant settlement to the lab
- Transaction reference number

## 3. Important Clarification

CCAvenue does **not** need to know:

- B2B client master data
- B2B client credit limit
- B2B client outstanding balance
- B2B client internal LIMS ID
- B2B client order history
- Lab-wise B2B relationship

CCAvenue only needs the payment request sent from AnPro LIMS using the selected lab’s CCAvenue merchant credentials.

## 4. Relationship Model

```text
AnPro LIMS Platform
        ↓
Multiple Lab Users / Tenants
        ↓
Each Lab may have its own B2B Clients
        ↓
One Lab may configure its own CCAvenue Merchant Account
        ↓
That lab's B2B clients pay through that lab's CCAvenue gateway
```

## 5. Example

Lab A has its own CCAvenue account.

Lab A has the following B2B clients inside AnPro LIMS:

- Dr. Patel Clinic
- City Hospital
- ABC Collection Center

These B2B clients are created and managed only inside AnPro LIMS.

CCAvenue does not create separate accounts for Dr. Patel Clinic, City Hospital, or ABC Collection Center.

When Dr. Patel Clinic exceeds its credit limit, AnPro LIMS sends a payment request to CCAvenue using **Lab A’s Merchant ID, Access Code, and Working Key**.

After successful payment, AnPro LIMS updates Dr. Patel Clinic’s credit balance internally.

## 6. Payment Trigger Logic

When a B2B client creates an order:

```text
Order Value = ₹10,000
Available Credit = ₹6,000
Shortfall = ₹4,000
```

The system should stop order registration and ask the B2B client to pay the required amount.

Payment options:

```text
Option 1: Pay only shortfall amount = ₹4,000
Option 2: Pay full order amount = ₹10,000
Option 3: Pay custom top-up amount = ₹20,000
```

Recommended initial implementation:

```text
Minimum payable amount = shortfall amount
```

## 7. Correct Workflow

```text
B2B Client logs into B2B Portal
        ↓
Creates test order
        ↓
System calculates order value
        ↓
System checks available credit
        ↓
If available credit is enough:
        ↓
Order is registered
Credit is consumed
        ↓
If available credit is not enough:
        ↓
Order registration is stopped temporarily
        ↓
System creates pending payment attempt
        ↓
B2B client is redirected to CCAvenue
        ↓
Payment is completed
        ↓
CCAvenue redirects back to AnPro LIMS
        ↓
AnPro LIMS verifies/decrypts response
        ↓
Credit ledger is updated
        ↓
Available credit is refilled
        ↓
Pending order is released/created
```

## 8. CCAvenue Credentials Required Per Lab

Each lab that wants to use CCAvenue should configure:

```text
Merchant ID
Access Code
Working Key
Redirect URL
Cancel URL
Environment: Test / Production
Status: Active / Inactive
```

These credentials belong to the **lab’s CCAvenue merchant account**, not to the B2B client.

## 9. Suggested Database Tables

### lab_payment_gateways

Stores payment gateway configuration for each lab.

```sql
CREATE TABLE lab_payment_gateways (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'ccavenue',
  merchant_id text NOT NULL,
  access_code text NOT NULL,
  working_key_encrypted text NOT NULL,
  environment text NOT NULL DEFAULT 'test',
  redirect_url text,
  cancel_url text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

### b2b_clients

Stores B2B client account and credit information.

```sql
CREATE TABLE b2b_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL,
  client_name text NOT NULL,
  credit_limit numeric(12,2) DEFAULT 0,
  credit_used numeric(12,2) DEFAULT 0,
  available_credit numeric(12,2) GENERATED ALWAYS AS (credit_limit - credit_used) STORED,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

### b2b_payment_attempts

Stores each payment attempt made by B2B clients.

```sql
CREATE TABLE b2b_payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL,
  b2b_client_id uuid NOT NULL,
  pending_order_id uuid,
  provider text NOT NULL DEFAULT 'ccavenue',
  ccavenue_order_id text NOT NULL,
  amount numeric(12,2) NOT NULL,
  currency text DEFAULT 'INR',
  status text DEFAULT 'initiated',
  raw_request jsonb,
  raw_response jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

### b2b_credit_ledger

Maintains all credit and debit movements.

```sql
CREATE TABLE b2b_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id uuid NOT NULL,
  b2b_client_id uuid NOT NULL,
  entry_type text NOT NULL,
  amount numeric(12,2) NOT NULL,
  reference_type text,
  reference_id uuid,
  balance_after numeric(12,2),
  remarks text,
  created_at timestamptz DEFAULT now()
);
```

## 10. Credit Ledger Entry Types

Recommended values:

```text
OPENING_CREDIT
ORDER_DEBIT
PAYMENT_CREDIT
MANUAL_CREDIT
MANUAL_DEBIT
ORDER_CANCEL_REVERSAL
REFUND_DEBIT
```

## 11. Backend Functions Required

Recommended Supabase Edge Functions / backend APIs:

```text
check-b2b-credit-limit
initiate-ccavenue-payment
ccavenue-payment-response
update-b2b-credit-ledger
release-pending-b2b-order
reconcile-ccavenue-payment
```

## 12. Frontend Pages Required

In B2B Portal:

```text
Create Order Page
Credit Limit Warning Modal
Payment Required Page
CCAvenue Redirect Page
Payment Success Page
Payment Failed Page
Payment History Page
Credit Ledger Page
```

In Lab Admin Panel:

```text
B2B Client Master
B2B Credit Limit Settings
B2B Payment History
B2B Outstanding Report
CCAvenue Gateway Settings
```

## 13. Security Rules

- Never expose Working Key in frontend.
- Encryption and decryption must happen only on backend.
- Store Working Key encrypted in database.
- Validate payment response before updating credit.
- Do not update credit only based on frontend success page.
- Always update credit from verified CCAvenue response.
- Maintain full raw response log for audit.
- Use idempotency so one payment cannot refill credit twice.

## 14. Idempotency Requirement

Before applying payment credit:

```text
Check if ccavenue_order_id already marked as success.
If already success, do not add credit again.
If not success, verify response and then add credit.
```

## 15. Final Answer

Yes, the B2B accounts will remain fully inside AnPro LIMS.

CCAvenue does not need to create or manage separate B2B client accounts.

Only the lab’s CCAvenue merchant credentials are required as the connection point between CCAvenue and AnPro LIMS.

The flow is:

```text
B2B client belongs to Lab inside AnPro LIMS
        ↓
Lab has CCAvenue merchant credentials
        ↓
B2B client pays through Lab’s CCAvenue gateway
        ↓
CCAvenue confirms payment
        ↓
AnPro LIMS updates B2B credit balance
```

## 16. Recommended One-Line Architecture

CCAvenue is only the payment collection layer; AnPro LIMS remains the source of truth for B2B clients, credit limits, orders, invoices, ledger, and payment reconciliation.
