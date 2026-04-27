# SaveX AI Presale Backend

NestJS backend for the SaveX AI token presale platform. Handles authentication, on-chain crypto payments (ETH / USDT / USDC), transaction flow, payment sessions with real-time updates (SSE), promo codes, and presale stage management.

## Tech Stack

- **Runtime**: NestJS (TypeScript)
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Auth**: JWT (access + refresh tokens) with token versioning
- **Blockchain**: ethers.js v6 (HD wallet, ERC-20, tx scanning)
- **Pricing**: Binance API (hourly cron → DB cache; transactions read from DB)
- **Mailing**: Resend API (with SMTP fallback)
- **Real-time**: Server-Sent Events (SSE)
- **Scheduling**: `@nestjs/schedule` (payment checking, sweep, session/quote expiry)
- **CRM**: Zoho CRM API v2 (contact sync via OAuth2 refresh token)
- **Validation**: `class-validator` + `class-transformer`

## Prerequisites

- Node.js v18+
- PostgreSQL running locally (or a remote instance)
- npm
- An Alchemy account (for Ethereum RPC access)

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Configure environment variables
cp .env.example .env
# Edit .env: set DATABASE_URL, JWT secrets, ALCHEMY_RPC_URL, HD_MASTER_MNEMONIC, etc.

# 3. Generate Prisma client
npx prisma generate

# 4. Run database migrations
npx prisma migrate dev

# 5. Seed the database (50 presale stages + admin user + promo code)
npm run prisma:seed

# 6. Start the development server
npm run start:dev
```

Server runs on `http://localhost:3001` with all routes prefixed under `/api`.

## Environment Variables

### Core

| Variable                           | Default                         | Description                       |
| ---------------------------------- | ------------------------------- | --------------------------------- |
| `DATABASE_URL`                     | (see .env.example)              | PostgreSQL connection string      |
| `JWT_ACCESS_SECRET`                | -                               | Secret for signing access tokens  |
| `JWT_REFRESH_SECRET`               | -                               | Secret for signing refresh tokens |
| `JWT_ACCESS_EXPIRATION`            | `15m`                           | Access token TTL                  |
| `JWT_REFRESH_EXPIRATION`           | `7d`                            | Refresh token TTL                 |
| `PORT`                             | `3001`                          | Server port                       |
| `FRONTEND_URL`                     | `http://localhost:3000`         | Allowed CORS origin               |
| `RESEND_API_KEY`                   | -                               | Resend API key for emails         |
| `EMAIL_FROM`                       | `onboarding@resend.dev`              | Sender email address              |

### Blockchain / Payment

| Variable                           | Default                         | Description                                        |
| ---------------------------------- | ------------------------------- | -------------------------------------------------- |
| `APP_ENV`                          | `development`                   | Application environment                            |
| `CHAIN`                            | `ethereum`                      | Blockchain network family                          |
| `NETWORK`                          | `sepolia`                       | Network name (sepolia / mainnet)                   |
| `CHAIN_ID`                         | `11155111`                      | Chain ID (11155111 = Sepolia, 1 = Mainnet)         |
| `ALCHEMY_RPC_URL`                  | -                               | Alchemy JSON-RPC endpoint                          |
| `BINANCE_API_URL`                  | `https://data-api.binance.vision`   | Binance public market data URL for ETH price   |
| `TREASURY_ADDRESS`                 | -                               | Treasury wallet (receives swept funds)             |
| `GAS_FUND_PRIVATE_KEY`             | -                               | Private key for gas funding wallet                 |
| `GAS_FUND_ADDRESS`                 | -                               | Address of gas funding wallet                      |
| `HD_MASTER_MNEMONIC`               | -                               | BIP-39 mnemonic for HD deposit address derivation  |
| `HD_DERIVATION_PATH`               | `m/44'/60'/0'/0`                | HD derivation base path                            |
| `ETH_PAYMENT_ENABLED`              | `true`                          | Enable ETH payments                                |
| `USDT_PAYMENT_ENABLED`             | `true`                          | Enable USDT payments                               |
| `USDC_PAYMENT_ENABLED`             | `true`                          | Enable USDC payments                               |
| `USDT_CONTRACT_ADDRESS`            | -                               | USDT ERC-20 contract address                       |
| `USDC_CONTRACT_ADDRESS`            | -                               | USDC ERC-20 contract address                       |
| `USDT_DECIMALS`                    | `6`                             | USDT token decimals                                |
| `USDC_DECIMALS`                    | `6`                             | USDC token decimals                                |
| `PAYMENT_QUOTE_DURATION_MINUTES`   | `15`                            | Quote validity window                              |
| `PAYMENT_SESSION_DURATION_MINUTES` | `60`                            | Payment session expiry                             |
| `PAYMENT_CHECK_INTERVAL_SECONDS`   | `30`                            | Blockchain polling interval                        |
| `MIN_CONFIRMATIONS_ETH`            | `2`                             | Min block confirmations for ETH payment detection  |
| `MIN_CONFIRMATIONS_ERC20`          | `2`                             | Min block confirmations for ERC-20 payment detection |
| `MIN_CONFIRMATIONS_SWEEP`          | `1`                             | Min block confirmations for gas topup + sweep tx   |
| `SWEEP_ENABLED`                    | `true`                          | Enable auto-sweep to treasury                      |
| `ALCHEMY_WEBHOOK_SIGNING_KEY`      | -                               | HMAC signing key from Alchemy Webhooks dashboard (optional but recommended in production) |
| `ZOHO_CLIENT_ID`                   | -                               | Zoho API Console Self-Client ID                    |
| `ZOHO_CLIENT_SECRET`               | -                               | Zoho API Console Self-Client secret                |
| `ZOHO_REFRESH_TOKEN`               | -                               | Zoho OAuth2 refresh token (scope: `ZohoCRM.modules.contacts.ALL`) |
| `ZOHO_BASE_URL`                    | `https://www.zohoapis.com`      | Zoho CRM API base URL (change suffix for EU/AU)    |
| `ZOHO_ACCOUNTS_URL`                | `https://accounts.zoho.com`     | Zoho OAuth2 token endpoint base URL                |
| `SENTRY_DSN`                      | -                               | Sentry DSN for error tracking. If unset, Sentry is disabled |
| `SWEEP_MAX_RETRIES`               | `2`                             | Max automatic retries for pre-broadcast sweep failures before marking session FAILED |
| `SWEEP_MIN_ETH_RESERVE_WEI`       | `100000000000000`               | Min ETH balance before gas topup for token sweep   |
| `GAS_TOPUP_AMOUNT_WEI`            | `500000000000000`               | ETH amount to send for gas topup                   |

## Payment Flow

```
User Request                  Backend
     |                           |
     |  POST /api/transactions   |
     |-------------------------->|
     |                           |-- 1. Validate presale stage
     |                           |-- 2. Validate promo code
     |                           |-- 3. Create locked quote (price snapshot from DB cache)
     |                           |-- 4. Derive HD deposit address
     |                           |-- 5. Atomic DB transaction:
     |                           |      - Claim derivation index (row lock)
     |                           |      - Create Transaction record
     |                           |      - Create PaymentSession
     |                           |      - Mark Quote as USED
     |                           |
     |  { depositAddress,        |
     |    expectedAmount,        |
     |    sessionId, ... }       |
     |<--------------------------|
     |                           |
     |  User sends crypto to     |
     |  depositAddress           |
     |                           |
     |  SSE /payment-sessions/   |
     |       :id/events          |
     |<..........................|-- Alchemy Webhook (instant push):
     |                           |     - Address Activity event received
     |                           |     - Verifies HMAC signature
     |   PAYMENT_DETECTED        |     - Detects payment, updates session
     |<..........................|
     |                           |-- Cron fallback (every 30s):
     |                           |     - Scans only new blocks since last tick
     |                           |     - Parallel batches of 5 sessions
     |<..........................|     - Check confirmations
     |                           |
     |   CONFIRMED /             |     - If confs >= min: CONFIRMED -> SWEEP_PENDING
     |   SWEEP_PENDING           |
     |<..........................|
     |                           |-- Cron (every 60s):
     |                           |     - ETH: sweep to treasury
     |                           |     - ERC-20: gas topup if needed, then sweep token
     |   SWEEPING                |
     |<..........................|     - Broadcast sweep tx: SWEEPING
     |                           |
     |   SETTLED                 |     - Sweep tx confirmed: SETTLED
     |<..........................|
```

### Session Statuses

| Status             | Meaning                                    | User-facing? |
| ------------------ | ------------------------------------------ | ------------ |
| `AWAITING_PAYMENT` | Waiting for user to send funds             | Yes          |
| `PAYMENT_DETECTED` | Tx found but insufficient confirmations    | Yes          |
| `UNDERPAID`        | Received amount < expected amount          | Yes (warning)|
| `CONFIRMED`        | Payment confirmed with enough blocks       | Yes (success)|
| `SWEEP_PENDING`    | Ready to sweep funds to treasury           | No (internal)|
| `SWEEPING`         | Sweep tx broadcast, awaiting confirmation  | No (internal)|
| `SETTLED`          | Sweep confirmed, payment fully complete    | No (internal)|
| `EXPIRED`          | Session expired without payment            | Yes          |
| `CANCELLED`        | Cancelled by user                          | Yes          |
| `FAILED`           | Unrecoverable error                        | Yes          |

### User Payment Lifecycle

From the user's perspective, a successful payment ends at **CONFIRMED**. The statuses `SWEEP_PENDING`, `SWEEPING`, and `SETTLED` are internal operational states that the frontend displays as "Payment Confirmed" with a success UI. Users are never shown sweep progress.

The frontend stepper shows 4 steps: **Created -> Awaiting Payment -> Detected -> Confirmed**.

`UNDERPAID` interrupts the flow at the "Detected" step with a warning -- it is never shown as a success state.

## Docker Deployment

The backend ships as a Docker image for production. The `Dockerfile` uses a two-stage build: stage 1 compiles TypeScript and generates the Prisma client; stage 2 produces a lean runtime image.

```bash
# Build for linux/amd64 (required for Render)
docker build --platform linux/amd64 -t youruser/savex-backend:latest .

# Push to Docker Hub
docker push youruser/savex-backend:latest
```

In Render, select **Existing Image** and point to your Docker Hub image. All environment variables are injected at runtime via Render's environment settings — no `.env` file is baked into the image.

After each code change:
1. Rebuild and push the image
2. Trigger a manual deploy in Render

> **Migrations are applied automatically.** The container start command runs `prisma migrate deploy` before starting the app, so no manual migration step is needed on Render.

## NPM Scripts

| Script                    | Description            |
| ------------------------- | ---------------------- |
| `npm run start:dev`       | Start in watch mode    |
| `npm run start:debug`     | Start with debugger    |
| `npm run build`           | Compile to `dist/`     |
| `npm run start:prod`      | Run compiled build     |
| `npm run prisma:generate` | Generate Prisma client |
| `npm run prisma:migrate`  | Run migrations         |
| `npm run prisma:seed`     | Seed database          |
| `npm run prisma:studio`   | Open Prisma Studio GUI |

## API Endpoints

### Auth

| Method | Path                            | Auth  | Description                            |
| ------ | ------------------------------- | ----- | -------------------------------------- |
| POST   | `/api/auth/register`            | No    | Register a new user                    |
| POST   | `/api/auth/login`               | No    | Login, returns access + refresh tokens |
| POST   | `/api/auth/refresh`             | No    | Refresh access token                   |
| GET    | `/api/auth/me`                  | JWT   | Get current user profile (includes `investmentStyle`) |
| PATCH  | `/api/auth/me`                  | JWT   | Update current user's `investmentStyle` (`SAFE` \| `GROWTH` \| `EXPLORE`) |
| GET    | `/api/auth/verify-email`        | No    | Verify user's email address            |
| POST   | `/api/auth/resend-verification` | No    | Resend email verification link         |
| POST   | `/api/auth/forgot-password`     | No    | Request a password reset email         |
| POST   | `/api/auth/reset-password`      | No    | Complete password reset                |
| POST   | `/api/auth/impersonate/:userId` | Admin | Impersonate another user               |

### Presale

| Method | Path                         | Auth | Description                  |
| ------ | ---------------------------- | ---- | ---------------------------- |
| GET    | `/api/presale/current-stage` | No   | Get the active presale stage        |
| GET    | `/api/presale/stages`        | No   | List all 50 presale stages          |
| GET    | `/api/presale/public-stats`  | No   | Get public presale stats (totalInvested, investorCount) |

### Transactions

| Method | Path                                 | Auth  | Description                                    |
| ------ | ------------------------------------ | ----- | ---------------------------------------------- |
| POST   | `/api/transactions`                  | JWT   | Create transaction + quote + payment session   |
| GET    | `/api/transactions`                  | JWT   | Get current user's transactions                |
| GET    | `/api/transactions/active-session`   | JWT   | Get user's active payment session              |
| GET    | `/api/transactions/my-stats`         | JWT   | Get user's personal transaction stats (totalTokens includes admin-granted `addedAmount`) |
| GET    | `/api/transactions/:id`              | JWT   | Get a specific transaction                     |
| GET    | `/api/transactions/admin/all`        | Admin | Get all transactions (admin)                   |
| GET    | `/api/transactions/admin/stats`      | Admin | Get transaction statistics (admin)             |
| PATCH  | `/api/transactions/admin/:id/status` | Admin | Update transaction status (admin)              |

#### POST /api/transactions

**Request:**
```json
{
  "paymentCurrency": "ETH",
  "usdAmount": 500,
  "promoCode": "SAVEX10"
}
```

**Response:**
```json
{
  "transactionId": "TXN1741484400000ABCD",
  "sessionId": "uuid",
  "depositAddress": "0x...",
  "paymentCurrency": "ETH",
  "expectedAmount": "0.250000000000000000",
  "expectedAmountBaseUnits": "250000000000000000",
  "expiresAt": "2026-03-09T03:00:00.000Z",
  "status": "AWAITING_PAYMENT",
  "quoteId": "uuid",
  "summary": {
    "usdAmount": 500,
    "tokenPrice": 0.003,
    "tokensAmount": 166666.67,
    "bonusTokens": 91666.67,
    "totalTokens": 258333.34
  }
}
```

### Payment Sessions

| Method | Path                               | Auth | Description                      |
| ------ | ---------------------------------- | ---- | -------------------------------- |
| GET    | `/api/payment-sessions/:id`                  | JWT  | Get session details              |
| GET    | `/api/payment-sessions/:id/events`           | No   | SSE stream for real-time updates |
| POST   | `/api/payment-sessions/:id/cancel`           | JWT  | Cancel a payment session         |
| PATCH  | `/api/payment-sessions/:id/payment-method`   | JWT  | Mark payment method (wallet/manual) and optional wallet address |

### Promo Codes

| Method | Path                        | Auth  | Description                |
| ------ | --------------------------- | ----- | -------------------------- |
| POST   | `/api/promo-codes`          | Admin | Create a promo code        |
| GET    | `/api/promo-codes/stats`    | Admin | Get promo codes statistics |
| GET    | `/api/promo-codes`          | Admin | List all promo codes       |
| POST   | `/api/promo-codes/validate` | JWT   | Validate a promo code      |
| PATCH  | `/api/promo-codes/:id`      | Admin | Update a promo code        |
| DELETE | `/api/promo-codes/:id`      | Admin | Deactivate a promo code    |

### Users

| Method | Path                     | Auth  | Description                      |
| ------ | ------------------------ | ----- | -------------------------------- |
| GET    | `/api/users/admin-stats` | Admin | Get platform user statistics     |
| GET    | `/api/users`             | Admin | List all users                   |
| GET    | `/api/users/:id`         | Admin | Get user details                 |
| PATCH  | `/api/users/:id`         | Admin | Update a user — patchable fields: `firstName`, `lastName`, `phone`, `status`, `suspendedReason`, `addedAmount` (SVX tokens granted manually) |

### Admin -- Sweep Manager

| Method | Path                          | Auth  | Description                         |
| ------ | ----------------------------- | ----- | ----------------------------------- |
| GET    | `/api/admin/sweeps/stats`     | Admin | Get sweep operation statistics      |
| GET    | `/api/admin/sweeps`           | Admin | List all sweep operations           |
| GET    | `/api/admin/sweeps/:id`       | Admin | Get sweep operation details         |
| POST   | `/api/admin/sweeps/:id/retry` | Admin | Retry a failed sweep operation      |

#### POST /api/admin/sweeps/:id/retry

Resets a sweep operation for retry by the cron processor. This is an admin override that works regardless of the automatic retry limit.

Fields reset on retry:
- `retryCount` += 1
- `error` = null
- `status` = PENDING
- `sweepTxHash` = null
- `gasTopupTxHash` = null

If the parent `PaymentSession` is in `FAILED` status, it is automatically moved back to `SWEEP_PENDING` so the cron picks it up.

### Admin -- Payment Sessions (Inspector + Flow Control)

| Method | Path                                    | Auth  | Description                                 |
| ------ | --------------------------------------- | ----- | ------------------------------------------- |
| GET    | `/api/admin/payment-sessions/stats`     | Admin | Get payment session statistics              |
| GET    | `/api/admin/payment-sessions`           | Admin | List all payment sessions (paginated)       |
| GET    | `/api/admin/payment-sessions/:id`       | Admin | Get full session detail with all relations  |
| PATCH  | `/api/admin/payment-sessions/:id`       | Admin | Modify session fields (with validation)     |

#### PATCH /api/admin/payment-sessions/:id

Allows modifying: `status`, `paymentTxHash`, `confirmations`, `receivedAmountBaseUnits`, `metadata`.

**Status transition validation** is enforced. Invalid transitions (e.g. `EXPIRED` -> `CONFIRMED`, `CANCELLED` -> `CONFIRMED`) are rejected with a `400 Bad Request`. Allowed transitions:

| From               | Allowed targets                                           |
| ------------------ | --------------------------------------------------------- |
| `AWAITING_PAYMENT` | PAYMENT_DETECTED, UNDERPAID, EXPIRED, CANCELLED, FAILED   |
| `PAYMENT_DETECTED` | CONFIRMED, UNDERPAID, FAILED, AWAITING_PAYMENT            |
| `UNDERPAID`        | AWAITING_PAYMENT, FAILED                                  |
| `CONFIRMED`        | SWEEP_PENDING, FAILED                                     |
| `SWEEP_PENDING`    | SWEEPING, FAILED                                          |
| `SWEEPING`         | SETTLED, FAILED                                           |
| `EXPIRED`          | AWAITING_PAYMENT (admin recovery)                         |
| `CANCELLED`        | AWAITING_PAYMENT (admin recovery)                         |
| `FAILED`           | AWAITING_PAYMENT, SWEEP_PENDING (admin recovery)          |
| `SETTLED`          | (no transitions allowed)                                  |

### Webhooks

| Method | Path                                  | Auth | Description                                          |
| ------ | ------------------------------------- | ---- | ---------------------------------------------------- |
| POST   | `/api/webhooks/alchemy/activity`      | None | Alchemy Address Activity webhook (HMAC verified)     |

### Admin -- Presale Stages

| Method | Path                                       | Auth  | Description                                 |
| ------ | ------------------------------------------ | ----- | ------------------------------------------- |
| GET    | `/api/admin/presale-stages/stats`          | Admin | Get presale stage statistics                |
| GET    | `/api/admin/presale-stages`                | Admin | List all presale stages (ordered by stage)  |
| PATCH  | `/api/admin/presale-stages/:id`            | Admin | Update stage price, bonus, or target        |
| POST   | `/api/admin/presale-stages/:id/activate`   | Admin | Set a stage as the active presale stage     |

#### PATCH /api/admin/presale-stages/:id

Allows modifying: `price`, `bonus`, `target`. All fields are optional numeric values.

#### POST /api/admin/presale-stages/:id/activate

Atomically deactivates all stages and activates the specified stage. Uses a Prisma `$transaction` to ensure only one stage is active at any time.

## Admin Tools

### Sweep Manager

Accessible at `/dashboard/sweeps` in the frontend admin panel. Displays all `SweepOperation` records with:

- Payment session, user, transaction details
- Asset, amount, sweep status, retry count
- Gas topup and sweep transaction hashes
- Error messages, created/updated timestamps
- **Retry button** to reset failed sweeps for another attempt

### Payment Session Inspector

Accessible at `/dashboard/payment-sessions-admin`. Provides a searchable, filterable table of all payment sessions with drill-down detail dialogs showing:

- Full session fields (deposit address, amounts, hashes, confirmations)
- Related user, transaction, quote, and sweep operation data
- Error reasons when present

### Flow Control

Accessible at `/dashboard/flow-control`. Allows admins to look up a payment session by ID and modify its state for recovery or debugging purposes. All status changes are validated server-side against the transition map above.

### Presale Stage Manager

Accessible at `/dashboard/presale-stages`. Provides a complete admin interface for managing presale stages:

- View all 50 stages with price, bonus %, target, and active status
- Edit stage parameters (price, bonus, target) via a dialog
- Activate any stage as the current presale stage (atomically deactivates all others)
- MetricCards showing active stage number, current token price, bonus %, and active stage target

## Database Schema

### Models

- **User** -- email, password (bcrypt), role (USER/ADMIN), status, email verification, password reset, `addedAmount` (admin-granted SVX tokens, included in the user's token balance), `investmentStyle` (user-selectable: SAFE / GROWTH / EXPLORE, default GROWTH)
- **PresaleStage** -- stage number, price, bonus %, target, isActive
- **PromoCode** -- code, bonus value %, max uses, usage count, isActive, expiresAt
- **Transaction** -- links user + stage + promo, stores usdAmount, tokenPrice, tokensAmount, bonusTokens, totalTokens, status
- **Quote** -- locked price snapshot: usdAmount (Decimal), asset, chain, assetPriceUsd (Decimal), expectedAmount, expectedAmountBaseUnits, tokenDecimals, expiresAt, status
- **PaymentSession** -- links to transaction + quote, depositAddress, derivationIndex, asset, expectedAmountBaseUnits, receivedAmountBaseUnits, paymentTxHash, confirmations, status, `lastScannedBlock` (high-water mark for incremental block scanning)
- **DerivationCounter** -- atomic counter for HD wallet derivation indices
- **SweepOperation** -- tracks sweep tx lifecycle: gasTopupTxHash, sweepTxHash, status, retryCount. Has `@@index([status])` for efficient cron queries.
- **TokenPrice** -- cached asset prices keyed by symbol (e.g. `ETH`). Updated every hour by `PricingCron`; read by `PricingService` at quote time to avoid live Binance API calls on every transaction.

### Enums

- **TransactionStatus**: PENDING, CONFIRMED, COMPLETED, CANCELLED, EXPIRED
- **SessionStatus**: AWAITING_PAYMENT, PAYMENT_DETECTED, UNDERPAID, CONFIRMED, EXPIRED, CANCELLED, SWEEP_PENDING, SWEEPING, SETTLED, FAILED
- **QuoteStatus**: ACTIVE, EXPIRED, USED
- **SweepStatus**: PENDING, GAS_SENT, SWEEPING, COMPLETED, FAILED
- **InvestmentStyle**: SAFE, GROWTH, EXPLORE

## Zoho CRM Integration

User data is synced to Zoho CRM Contacts automatically on three events:

| Trigger | Fields synced |
|---|---|
| User registers | First Name, Last Name, Phone, Email, Investor Status (`Non-Investor`) |
| Investment settled (COMPLETED) | + Investor Status (`Investor`), Amount Invested USD, Total Tokens Owned |
| Admin updates name or `addedAmount` | First Name, Last Name, Added Amount SVX, Total Tokens Owned |

All syncs are fire-and-forget — failures are logged but never block the main request flow.

### Required Zoho Setup

1. Go to **Zoho CRM → Settings → Modules → Contacts → Fields** and create these custom fields:

| Field Label | API Name | Type |
|---|---|---|
| Investor Status | `Investor_Status` | Picklist: `Investor` / `Non-Investor` |
| Amount Invested USD | `Amount_Invested_USD` | Currency / Decimal |
| Total Tokens Owned | `Total_Tokens_Owned` | Decimal |
| Added Amount SVX | `Added_Amount_SVX` | Decimal |

2. Go to [api-console.zoho.com](https://api-console.zoho.com) → **Self Client** → create a client.
3. Generate a refresh token with scope: `ZohoCRM.modules.contacts.ALL`.
4. Set `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, and `ZOHO_REFRESH_TOKEN` in `.env`.
5. If your Zoho account is on a non-`.com` data center (EU, AU), update `ZOHO_BASE_URL` and `ZOHO_ACCOUNTS_URL` accordingly.

---

## Sepolia Testing

### Setup

1. Get a Sepolia Alchemy RPC URL from [alchemy.com](https://www.alchemy.com/)
2. Generate a **secret** test mnemonic (see `.env.example` for the command -- do NOT use the Hardhat default)
3. Fund derived addresses with Sepolia ETH from a faucet
4. Deploy mock ERC-20 tokens (USDT/USDC) on Sepolia, or use existing test tokens
5. Set token contract addresses in `.env`

### Environment for Sepolia

```env
NETWORK=sepolia
CHAIN_ID=11155111
ALCHEMY_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
USDT_CONTRACT_ADDRESS=0x...your_mock_usdt...
USDC_CONTRACT_ADDRESS=0x...your_mock_usdc...
HD_MASTER_MNEMONIC="your-own-secret-mnemonic-here"
TREASURY_ADDRESS=0x...your_sepolia_treasury...
GAS_FUND_PRIVATE_KEY=0x...your_gas_fund_pk...
GAS_FUND_ADDRESS=0x...your_gas_fund_address...
```

### Testing Flow

1. Start backend: `npm run start:dev`
2. Register a user and login to get JWT
3. `POST /api/transactions` with `{ "paymentCurrency": "ETH", "usdAmount": 100 }`
4. Note the `depositAddress` in the response
5. Send Sepolia ETH to that address using MetaMask or a script
6. Watch the SSE stream at `/api/payment-sessions/:id/events` for status updates
7. After `MIN_CONFIRMATIONS_ETH` confirmations, the session moves to CONFIRMED -> SWEEP_PENDING
8. The sweep cron sends funds to your treasury address

## Project Structure

```
src/
├── instrument.ts              # Sentry initialisation (imported first in main.ts)
├── main.ts                    # Entry point, CORS, validation, filters
├── app.module.ts              # Root module
├── common/
│   ├── decorators/            # @CurrentUser, @Roles
│   ├── guards/                # RolesGuard
│   └── filters/               # GlobalExceptionFilter
├── auth/                      # Register, login, refresh, JWT strategy
├── users/                     # User CRUD (admin)
├── presale/                   # Stage queries
├── promo-codes/               # Promo CRUD + validation
├── transactions/              # Transaction creation + history
├── payment-sessions/          # Session details, SSE, cancel, cron jobs
├── quotes/                    # Internal quote service (price snapshot)
├── pricing/                   # Binance API price fetching + hourly cron cache
├── evm/                       # Ethereum blockchain interaction (HD wallet, tx scanning, sweep, Alchemy webhook)
├── admin/                     # Admin endpoints (sweeps, sessions, flow control, presale stages)
├── email/                     # Email service (Resend + SMTP)
├── zoho/                      # Zoho CRM contact sync (OAuth2, upsert)
└── prisma/                    # PrismaService (global)
```

## Seeded Data

After running `npm run prisma:seed`:

- **Admin user**: `admin@savex.ai` / `admin123`
- **Promo code**: `SAVEX10` (10% bonus)
- **50 presale stages** with stage 1 active
- **DerivationCounter** initialized at index 0
