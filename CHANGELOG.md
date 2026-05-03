# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

---

## 2026-05-02 — Dynamic Payment Limits (Admin-Controlled)

### Added
- **`prisma/schema.prisma`** — New `AppSetting` model (`key String @id`, `value String`, `updatedAt DateTime @updatedAt`) with migration `20260502192707_add_app_settings`.
- **`src/settings/`** — New `SettingsModule` with:
  - `SettingsService.getPaymentLimits()` — reads `minPayment` / `maxPayment` keys from `AppSetting`, falling back to defaults (100 / 50000) if not yet set.
  - `SettingsService.updatePaymentLimits()` — upserts both keys in a single `$transaction`.
  - `GET /settings/payment-limits` — public endpoint (no auth); used by the frontend purchase form.
  - `PATCH /settings/payment-limits` — admin-only endpoint (JWT + `ADMIN` role); accepts `{ minPayment, maxPayment }`.

### Changed
- **`src/transactions/dto/create-transaction.dto.ts`** — Removed static `@Min(100)` / `@Max(50000)` decorators from `usdAmount`. Limits are now dynamic.
- **`src/transactions/transactions.service.ts`** — `create()` fetches live limits from `SettingsService` and throws `BadRequestException` if `usdAmount` is out of range. The existing global HTTP filter already captures 4xx on `/transactions` as Sentry warnings, so payment limit violations are tracked automatically.
- **`src/transactions/transactions.module.ts`** — Imports `SettingsModule`.
- **`src/app.module.ts`** — Imports `SettingsModule`.

---

## 2026-05-02 — Full Payment Flow Sentry Coverage

### Added
- **`src/evm/evm.service.ts`** — `Sentry.captureException` added to all blockchain methods:
  - `checkNativePayment` — ETH payment scan failures now reported (previously logged only, silently returned `null`)
  - `checkTokenPayment` — ERC-20 Transfer event scan failures now reported
  - `getConfirmations` — confirmation check failures now reported
  - `sweepNative` — wrapped in try/catch; captures and rethrows so the cron catch also fires
  - `sweepToken` — same pattern
  - `topUpGas` — captures gas fund wallet errors (unconfigured wallet, insufficient balance, RPC failure)
  - `getBalance` — RPC failures now captured instead of propagating silently

- **`src/payment-sessions/payment-sessions.cron.ts`** — additional Sentry captures inside `processSingleSweep`:
  - ETH sweep failure (`step: 'sweepNative'`)
  - ERC-20 sweep failure (`step: 'sweepToken'`)
  - Gas top-up failure (`step: 'topUpGas'`) — previously warned and silently retried with no Sentry alert
  - Sweep tx reverted on-chain (`step: 'sweepTxReverted'`) — explicit `new Error` with tx hash in message
  - Max retries exceeded (`step: 'maxRetriesExceeded'`) — alerts before session is marked FAILED

- **`src/payment-sessions/payment-sessions.service.ts`** — Sentry captures added:
  - `markFailed` — every session transition to `FAILED` now fires `captureException` tagged with `sessionId`
  - `markSettled` — Zoho `upsertContact` call wrapped in `.catch()` with `captureException`; can no longer throw synchronously and block settlement

- **`src/transactions/transactions.service.ts`** — block number fetch failure in `create()` now captured (previously only `logger.warn`)

- **`src/quotes/quotes.service.ts`** — Sentry captures added:
  - `createQuote` — pricing service failure captured before rethrowing
  - `expireQuotes` — DB `updateMany` failure captured

- **`src/pricing/pricing.service.ts`** — `fetchAndStoreEthPrice` wrapped in try/catch; Binance HTTP errors, timeout, and invalid price responses now captured before rethrowing

### Changed
- **`src/common/filters/http-exception.filter.ts`** — 4xx errors on `/transactions`, `/payment-sessions`, and `/quotes` routes are now forwarded to Sentry as `level: 'warning'`. This surfaces unexpected mid-flow client errors (expired quote claimed, session not found during cron, etc.) without flooding Sentry with normal auth/validation noise.

---

## 2026-04-28 — Fix ZOHO_ENABLED Guard

### Fixed
- **`ZohoService.upsertContact`** — guard changed from `!configService.get('ZOHO_ENABLED')` to `!== 'true'`. The previous check treated the string `"false"` as truthy, causing Zoho syncs to fire even when `ZOHO_ENABLED=false` was explicitly set in the environment.

---

## 2026-04-27 — Tracking Guard (ZOHO_ENABLED / NEXT_PUBLIC_TRACKING_ENABLED)

### Added
- **`ZOHO_ENABLED` env var** (`src/zoho/zoho.service.ts`) — Zoho CRM upserts are now skipped unless `ZOHO_ENABLED=true`. Prevents test registrations and payments from polluting the CRM during local dev or staging. Set to `true` in Render production env only.
- **`.env.example`** — `ZOHO_ENABLED` documented under the Zoho CRM section.

---

## 2026-04-27 — Zoho CRM Reliability Fixes

### Fixed
- **`src/zoho/zoho.service.ts`** — phone number sanitized before sending to Zoho CRM. Characters outside `[0-9 + \- ( ) .]` are stripped, preventing `INVALID_DATA` rejections for numbers formatted with slashes (e.g. `0170/5550638`). Root cause: Zoho returns HTTP 200 with `status: "error"` in the body — the previous code logged "Contact created" regardless.
- **Response validation** — `create` and `update` calls now inspect `res.data.data[0].status` and log a proper error if Zoho rejects the record, instead of silently succeeding.

### Added
- **Sentry capture** (`src/zoho/zoho.service.ts`) — `Sentry.captureException` added for both Zoho API rejections (`status: "error"` in response body) and network/auth exceptions. Tagged with `userId` and `zohoAction` for filtering in Sentry dashboard.

---

## 2026-04-27 — EVM Payment Scanning Optimisation

### Changed
- **`EvmPaymentService.checkTokenPayment`** — `MAX_BLOCK_RANGE` increased from 10 to 2000, reducing `eth_getLogs` calls from ~500 to ~3 per session per cron tick.
- **`EvmPaymentService.checkNativePayment` / `checkTokenPayment`** — both now accept an optional `latestBlock` parameter so the cron can share a single `eth_blockNumber` call across all active sessions instead of one per session.
- **`PaymentSessionsCron.checkActivePayments`** — fetches `latestBlock` once per tick and passes it to all session checks. Sessions are now processed in parallel batches of 5 (`Promise.all` + concurrency limiter) instead of sequentially.
- **`PaymentSessionsCron.checkSingleSession`** — uses `lastScannedBlock` persisted on the session to scan only blocks newer than the previous tick. On first check it falls back to `creationBlockNumber`. The high-water mark is written back to the DB after each scan, so each tick costs ~1–3 RPC calls instead of re-scanning from session start.
- **`PaymentSession` Prisma model** — new `lastScannedBlock Int?` field; migration `20260427011542_add_last_scanned_block` applied.

---

## 2026-04-25 — Switch ETH Pricing to Binance

### Changed
- **`PricingService`** — replaced CryptoCompare with Binance (`/api/v3/ticker/price?symbol=ETHUSDT`). No API key required, no rate limit issues.
- **`BINANCE_API_URL`** env var replaces `CRYPTOCOMPARE_API_URL` (default: `https://api.binance.com`).

---

## 2026-04-23 — Switch ETH Pricing to CryptoCompare (reverted)

### Changed
- Switched from CoinGecko to CryptoCompare — reverted same day after discovering CryptoCompare now requires an API key for all requests.

---

## 2026-04-22 — Sentry Integration, DB-Cached ETH Price & Registration Email Decoupling

### Added (Sentry)
- **`@sentry/nestjs` + `@sentry/profiling-node`** installed.
- **`src/instrument.ts`** — Sentry initialisation. Imported as the very first line of `main.ts` so it instruments the process before anything else loads. Enabled only when `SENTRY_DSN` is set; safe to deploy without it.
- **`SENTRY_DSN`** env var — added to `.env.example`. Add to Render environment settings (get from Sentry project → Settings → Client Keys). If unset, Sentry is fully disabled — safe for local dev without configuration.
- **Global exception filter** (`src/common/filters/http-exception.filter.ts`) — 5xx errors are now forwarded to Sentry automatically. 4xx errors (validation, auth) are intentionally excluded.
- **`PricingCron`** — `captureException` on ETH price refresh failure, tagged `cron: refreshPrices`.
- **`PaymentSessionsCron`** — `captureException` on payment check and sweep errors, tagged with `cron` name and `sessionId` for fast lookup.

---

## 2026-04-22 — DB-Cached ETH Price & Registration Email Decoupling

### Added
- **`TokenPrice` Prisma model** — stores `symbol`, `priceUsd`, and `updatedAt`. Used as the single source of truth for asset prices at quote/transaction time.
- **`PricingCron`** (`src/pricing/pricing.cron.ts`) — `@nestjs/schedule` cron job that refreshes ETH price from CoinGecko every hour and upserts it into `TokenPrice`. A failed refresh logs an error but leaves the last known price intact.
- **`prisma migrate deploy`** in `Dockerfile` start command — migrations are now applied automatically on every Render deploy before the app starts.

### Changed
- **`PricingService.getEthPriceUsd()`** — now reads from the `TokenPrice` DB table instead of calling CoinGecko on every transaction. Falls back to a live CoinGecko fetch only if the DB row is missing or older than 2 hours (cron missed twice). Eliminates 429 rate-limit errors on transaction creation.
- **`PricingModule`** — now imports `PrismaModule` and registers `PricingCron` as a provider.

### Fixed
- **Registration blocked by email delivery failure** (`src/auth/auth.service.ts`) — verification email is now sent in the background (fire-and-forget with `.catch()` logging). A Resend rejection (e.g. spam-trap addresses like `test@gmail.com`) or SMTP failure no longer causes `register()` to throw, so the user account is always created and the success response is always returned. Users can trigger resend via the existing `/resend-verification` endpoint.

---

## 2026-04-21 — Docker & CORS Improvements

### Added
- **`Dockerfile`** — multi-stage Docker build for the backend. Stage 1 compiles TypeScript and generates the Prisma client; stage 2 produces a lean `node:22-alpine` production image with only runtime dependencies. Built for `linux/amd64` (Render compatibility).

### Fixed
- **CORS origin handling** (`src/main.ts`) — replaced the single-string `origin` with a callback that strips trailing slashes before comparing, so both `https://www.savexai.com` and `https://www.savexai.com/` are accepted correctly.

---

## 2026-04-20 — Zoho CRM Integration

### Added
- **Zoho CRM module** (`src/zoho/`) — `ZohoService` handles OAuth2 token management (in-memory cache with auto-refresh), contact upsert (search by email → create or update), and aggregation of investment data from the database. Errors are caught and logged without surfacing to callers (fire-and-forget).
- **Contact sync on user registration** — `AuthService.register()` fires `upsertContact` after the verification email is sent. Creates a Zoho Contact with name, email, and phone; `Investor_Status` defaults to `Non-Investor`.
- **Contact sync on investment settled** — `PaymentSessionsService.markSettled()` fires `upsertContact` after a transaction reaches `COMPLETED`. Updates `Investor_Status` → `Investor`, `Amount_Invested_USD` (sum of all completed transaction USD amounts), and `Total_Tokens_Owned` (sum of completed transaction tokens + admin-granted `addedAmount`).
- **Contact sync on admin user update** — `UsersService.update()` fires `upsertContact` when `firstName`, `lastName`, or `addedAmount` is patched. Skips sync for status/suspension-only updates.
- **Zoho env vars** added to `.env.example`: `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_BASE_URL`, `ZOHO_ACCOUNTS_URL`.

### Zoho CRM custom fields required
The following fields must be created manually in **Zoho CRM → Settings → Modules → Contacts → Fields** before enabling the integration:

| Field Label | API Name | Type |
|---|---|---|
| Investor Status | `Investor_Status` | Picklist: Investor / Non-Investor |
| Amount Invested USD | `Amount_Invested_USD` | Currency / Decimal |
| Total Tokens Owned | `Total_Tokens_Owned` | Decimal |
| Added Amount SVX | `Added_Amount_SVX` | Decimal |

---

## 2026-04-09 — Admin Can Manually Verify User Emails

### Changed
- **`UpdateUserDto`** (`src/users/dto/update-user.dto.ts`) — added `isEmailVerified?: boolean` field (validated with `@IsBoolean()`). The existing `PATCH /users/:id` admin endpoint now accepts this field and writes it directly to the database, allowing admins to manually verify or un-verify a user's email.

---

## 2026-04-08 — User Investment Style Preference

### Added
- **`InvestmentStyle` enum** (`SAFE`, `GROWTH`, `EXPLORE`) added to Prisma schema.
- **`investmentStyle` field** on `User` model — defaults to `GROWTH`; persisted in PostgreSQL.
- **`GET /api/auth/me`** now performs a real database query (via `UsersService.getMe`) and returns `investmentStyle` alongside the user profile.
- **`PATCH /api/auth/me`** (JWT) — new endpoint allowing the authenticated user to update their own `investmentStyle`. Accepts `{ "investmentStyle": "SAFE" | "GROWTH" | "EXPLORE" }`.
- **`UpdateMeDto`** (`src/users/dto/update-me.dto.ts`) — validates the `investmentStyle` field as a Prisma enum.
- `UsersModule` imported into `AuthModule` so `UsersService` is injectable in `AuthController`.

---

## 2026-04-04

### Fixed
- **`tsconfig.json`** — Removed deprecated `baseUrl: "./"` and updated path mapping from `"@/*": ["src/*"]` to `"@/*": ["./src/*"]` so the alias resolves correctly without relying on `baseUrl` (deprecated in TypeScript 7.0).
- **`expectedAmount` stored correctly** — `transactions.service.ts` now uses `quote.expectedAmount` instead of `dto.usdAmount` when creating the Prisma Decimal, keeping `expectedAmount` consistent with `expectedAmountBaseUnits`.

### Added
- **`PATCH /api/payment-sessions/:id/payment-method`** (JWT) — Marks a session's payment method (`wallet` or `manual`) and optional `walletAddress` into `paymentSession.metadata`. Called automatically by the frontend on successful wallet broadcast.
- **`tokenContractAddress`** included in the payment session DTO response, so clients receive the ERC-20 contract address for token-based payments.

---

## 2026-04-01

### Added
- **`GET /api/presale/public-stats`** (public) — Returns `totalInvested` and `investorCount` derived from confirmed/completed transactions. Used by the frontend presale stats component.

---

## 2026-03-16

### Added
- **`MIN_CONFIRMATIONS_SWEEP`** env variable — configurable minimum block confirmations for gas topup and sweep tx checks (default `1`, previously hardcoded).

### Fixed
- `totalUsdRaised` and `totalTokensSold` in admin transaction stats now only aggregate `COMPLETED` and `CONFIRMED` transactions — previously included `FAILED` and other non-final statuses.
- `totalTarget` in presale stage stats now returns the active stage's target instead of summing all 50 stages — fixes an incorrect `$188M+` aggregated value.
- `getUserStats` (`GET /api/transactions/my-stats`) now includes admin-granted `addedAmount` in `totalTokens` — previously only summed tokens from completed transactions.
- Sweep cron no longer loops indefinitely when a gas topup is confirmed but the deposit wallet balance is still zero (drained wallet / wrong mnemonic). The sweep operation is now marked `FAILED` so the retry cap applies.

---

## 2026-03-10 — Admin Module & EVM Payments

### Added
- **Admin module** (`src/admin/`) with controllers and services for:
  - Sweep Manager: stats, list, detail, retry (`POST /api/admin/sweeps/:id/retry`)
  - Payment Session Inspector + Flow Control: stats, list, detail, patch with status transition validation
  - Presale Stage Manager: stats, list, patch, activate
- Server-side payment session **status transition validation** — invalid transitions rejected with `400 Bad Request`.
- Admin retry flow — resets sweep fields and restores `PaymentSession` to `SWEEP_PENDING` when retrying from `FAILED`.
- `@@index([status])` on `SweepOperation` (+ migration) for efficient cron queries.
- **EVM module** (`src/evm/`) — ethers.js v6 HD wallet, address derivation, block scanning (ETH + ERC-20 Transfer events), gas topup, and sweep hooks.
- Prisma schema + migrations for `Quote`, `SweepOperation`, `DerivationCounter`; extended `PaymentSession` with `depositAddress`, `quoteId`, `asset`, `decimals`, `confirmations`, `tokenContractAddress`, `metadata`.
- New enums: `QuoteStatus` (ACTIVE, EXPIRED, USED), `SweepStatus` (PENDING, GAS_SENT, SWEEPING, COMPLETED, FAILED); extended `SessionStatus` with `SWEEP_PENDING`, `SWEEPING`, `SETTLED`, `FAILED`.
- Payment session cron jobs: blockchain polling every 30s for payment detection/confirmation, sweep cron every 60s (gas topup + sweep broadcast + settlement).
- `ethers` and `axios` added to dependencies.

---

## 2026-03-06 — Auth Enhancements & Admin Impersonation

### Added
- **Admin impersonation** — `POST /api/auth/impersonate/:userId` (Admin only). Validates target user is not suspended, generates tokens, returns minimal user info.
- Pagination, search, and filtering across promo codes, transactions, and users.
- `GET /api/transactions/admin/stats` and `GET /api/users/admin-stats` endpoints.
- `PATCH /api/transactions/admin/:id/status` endpoint.
- Custom transaction ID generation (e.g. `TXN1741484400000ABCD`).
- Per-user aggregate stats (total invested, tokens, etc.) in admin user listing.

---

## 2026-03-05 — Email Service & Initial Backend

### Added
- **Email module** (`src/email/`) — Resend API with SMTP nodemailer fallback; HTML templates for verification, password reset, and suspension notices.
- Email verification flow: `GET /api/auth/verify-email`, `POST /api/auth/resend-verification`.
- Password reset flow: `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`.
- JWT **token versioning** — server-side invalidation; checked in JWT strategy and refresh logic.
- Login enforces email-verified and account status checks.
- `addedAmount` field on `User` — admin-grantable SVX token balance included in user stats.
- User suspension handling (email sent on suspension).
- Initial NestJS backend: Auth (register, login, refresh, JWT strategy), Users, Presale stages, Promo codes, Transactions, Payment sessions (SSE, cancel), Quotes, Pricing (CoinGecko), Prisma schema + seed (50 stages, admin user, `SAVEX10` promo code).
