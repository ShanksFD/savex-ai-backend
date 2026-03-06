# SaveX AI Presale Backend

NestJS backend for the SaveX AI token presale platform. Handles authentication, transaction flow, payment sessions with real-time updates (SSE), promo codes, and presale stage management.

## Tech Stack

- **Runtime**: NestJS (TypeScript)
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Auth**: JWT (access + refresh tokens) with token versioning
- **Mailing**: Resend API (with SMTP fallback)
- **Real-time**: Server-Sent Events (SSE)
- **Scheduling**: `@nestjs/schedule` (session expiry cron)
- **Validation**: `class-validator` + `class-transformer`

## Prerequisites

- Node.js v18+
- PostgreSQL running locally (or a remote instance)
- npm or pnpm

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Configure environment variables
# Copy .env.example to .env and update DATABASE_URL and JWT secrets
cp .env.example .env

# 3. Generate Prisma client
npx prisma generate

# 4. Run database migrations
npx prisma migrate dev --name init

# 5. Seed the database (50 presale stages + admin user + promo code)
npm run prisma:seed

# 6. Start the development server
npm run start:dev
```

Server runs on `http://localhost:3001` with all routes prefixed under `/api`.

## Environment Variables

| Variable                           | Default                                                                     | Description                       |
| ---------------------------------- | --------------------------------------------------------------------------- | --------------------------------- |
| `DATABASE_URL`                     | `postgresql://postgres:postgres@localhost:5432/savex_presale?schema=public` | PostgreSQL connection string      |
| `JWT_ACCESS_SECRET`                | -                                                                           | Secret for signing access tokens  |
| `JWT_REFRESH_SECRET`               | -                                                                           | Secret for signing refresh tokens |
| `JWT_ACCESS_EXPIRATION`            | `15m`                                                                       | Access token TTL                  |
| `JWT_REFRESH_EXPIRATION`           | `7d`                                                                        | Refresh token TTL                 |
| `PAYMENT_SESSION_DURATION_MINUTES` | `60`                                                                        | Payment session expiry in minutes |
| `PORT`                             | `3001`                                                                      | Server port                       |
| `FRONTEND_URL`                     | `http://localhost:3000`                                                     | Allowed CORS origin               |
| `RESEND_API_KEY`                   | -                                                                           | Resend API key for emails         |
| `MAIL_FROM`                        | `noreply@savex.ai`                                                          | Sender email address              |
| `SMTP_HOST`                        | -                                                                           | Fallback SMTP Host                |
| `SMTP_PORT`                        | `587`                                                                       | Fallback SMTP Port                |
| `SMTP_USER`                        | -                                                                           | Fallback SMTP User                |
| `SMTP_PASS`                        | -                                                                           | Fallback SMTP Password            |

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
| GET    | `/api/auth/me`                  | JWT   | Get current authenticated user         |
| GET    | `/api/auth/verify-email`        | No    | Verify user's email address            |
| POST   | `/api/auth/resend-verification` | No    | Resend email verification link         |
| POST   | `/api/auth/forgot-password`     | No    | Request a password reset email         |
| POST   | `/api/auth/reset-password`      | No    | Complete password reset                |
| POST   | `/api/auth/impersonate/:userId` | Admin | Impersonate another user               |

### Presale

| Method | Path                         | Auth | Description                  |
| ------ | ---------------------------- | ---- | ---------------------------- |
| GET    | `/api/presale/current-stage` | No   | Get the active presale stage |
| GET    | `/api/presale/stages`        | No   | List all 50 presale stages   |

### Transactions

| Method | Path                                 | Auth  | Description                            |
| ------ | ------------------------------------ | ----- | -------------------------------------- |
| POST   | `/api/transactions`                  | JWT   | Create a transaction + payment session |
| GET    | `/api/transactions`                  | JWT   | Get current user's transactions        |
| GET    | `/api/transactions/active-session`   | JWT   | Get user's active session              |
| GET    | `/api/transactions/my-stats`         | JWT   | Get user's personal transaction stats  |
| GET    | `/api/transactions/:id`              | JWT   | Get a specific transaction             |
| GET    | `/api/transactions/admin/all`        | Admin | Get all transactions (admin)           |
| GET    | `/api/transactions/admin/stats`      | Admin | Get transaction statistics (admin)     |
| PATCH  | `/api/transactions/admin/:id/status` | Admin | Update transaction status (admin)      |

### Payment Sessions

| Method | Path                               | Auth | Description                      |
| ------ | ---------------------------------- | ---- | -------------------------------- |
| GET    | `/api/payment-sessions/:id`        | JWT  | Get session details              |
| GET    | `/api/payment-sessions/:id/events` | No   | SSE stream for real-time updates |
| POST   | `/api/payment-sessions/:id/cancel` | JWT  | Cancel a payment session         |

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
| PATCH  | `/api/users/:id`         | Admin | Update a user (including status) |

## Database Schema

### Models

- **User** -- email, password (bcrypt), firstName, lastName, phone, role (USER/ADMIN), status (ACTIVE/SUSPENDED), tokenVersion, addedAmount (total spent), email verification & password reset fields
- **PresaleStage** -- stage number, price, bonus %, target, isActive flag
- **PromoCode** -- code, bonus value %, max uses, usage count, isActive, expiresAt
- **Transaction** -- links user + stage + promo, stores usdAmount, tokenPrice, tokensAmount, bonusTokens, totalTokens, status
- **PaymentSession** -- links to transaction, walletAddress, expectedAmount, currency, status, expiresAt

### Enums

- **TransactionStatus**: PENDING, CONFIRMED, COMPLETED, CANCELLED, EXPIRED
- **SessionStatus**: AWAITING_PAYMENT, PAYMENT_DETECTED, CONFIRMED, EXPIRED, CANCELLED

## Transaction Flow

1. Frontend sends `POST /api/transactions` with `{ paymentCurrency, usdAmount, promoCode }`
2. Backend validates input, gets current stage, calculates tokens server-side
3. Creates Transaction + PaymentSession (1h expiry) in a database transaction
4. Returns `{ sessionId, redirectUrl, summary }`
5. Frontend redirects to payment page, connects to SSE stream
6. Cron job runs every 30s to expire overdue sessions

## Seeded Data

After running `npm run prisma:seed`:

- **Admin user**: `admin@savex.ai` / `admin123`
- **Promo code**: `SAVEX10` (10% bonus)
- **50 presale stages** with stage 1 active

## Project Structure

```
src/
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
├── payment-sessions/          # Session details, SSE, cancel, cron
└── prisma/                    # PrismaService (global)
```
