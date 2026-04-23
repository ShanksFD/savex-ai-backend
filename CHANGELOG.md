# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

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
