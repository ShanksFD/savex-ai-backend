# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

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
