# BlockLand Backend API

## Prerequisites
- Node.js (v18+)
- PostgreSQL (v15+)
- npm or yarn

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Environment Configuration:**
   Copy `.env.example` to `.env` and update the values.
   ```bash
   cp .env.example .env
   # Make sure to set a valid DATABASE_URL in .env
   ```

3. **Database Migration:**
   ```bash
   npx prisma generate
   npx prisma db push
   # Or for migrations: npm run prisma:migrate
   ```

4. **Start Server:**
   ```bash
   npm run dev
   ```

## Roles
- **USER**: Regular land owner or developer. Can register land, initiate transfers.
- **GOVERNMENT**: Government official who verifies land registrations and approves transfers.
- **ADMIN**: Super admin with full system access.

## API Endpoints Overview

- **Auth**: `/api/v1/auth/register`, `/api/v1/auth/login`, `/api/v1/auth/me`
- **Lands**: `/api/v1/lands`
- **Transfers**: `/api/v1/transfers`
- **Projects**: `/api/v1/projects`
- **Fractional Ownership**: `/api/v1/fractional`
- **Users/Me**: `/api/v1/me`
- **Verification**: `/api/v1/verification` (Gov/Admin only)
- **Builders**: `/api/v1/builders`
- **Documents**: `/api/v1/documents`

## Environment Variables
- `DATABASE_URL` - PostgreSQL connection string
- `PORT` - API Port (default 4000)
- `JWT_SECRET` / `JWT_REFRESH_SECRET` - JWT Secrets
- `FRONTEND_URL` - Frontend origin URL
- `PINATA_*` - optional IPFS pinning
- `SMTP_*` - optional verification emails
- `TWILIO_*` - optional SMS OTP (demo OTP `123456` otherwise)
- `REDIS_URL` - optional Redis cache + BullMQ
- `GOOGLE_CLIENT_ID` - optional Google OAuth

Swagger: `http://localhost:4000/api/v1/docs`

```bash
npm test
```
