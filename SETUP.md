# BlockLand Setup

## Prerequisites

- Node.js ≥ 18
- Docker & Docker Compose
- npm 9+ (workspaces)

## Steps

1. **Clone / unzip** this project and open a terminal in the root.

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment**
   ```bash
   cp .env.example .env
   ```
   At minimum set `JWT_SECRET` and `JWT_REFRESH_SECRET` to long random values for anything beyond local demo.

4. **Start Postgres + Redis**
   ```bash
   docker compose up -d
   ```

5. **Prisma**
   ```bash
   npm run db:generate
   npm run db:push
   ```
   No demo seed data is included in this copy.


6. **API**
   ```bash
   npm run dev:api
   ```
   Confirm: http://localhost:4000/health

7. **Web**
   ```bash
   npm run dev:web
   ```
   Open: http://localhost:3000

## Optional: Contracts

```bash
npm run contracts:compile
npm run contracts:test
npm run contracts:deploy
```

Set `REGISTRY_CONTRACT_ADDRESS` in `.env` after deploy.

## Optional: Production-ish

- Build API: `npm run build:api` then `npm run start:api`
- Build Web: `npm run build:web` then `npm run start:web`
- Use real SMTP / Twilio / Pinata keys from `.env.example`
- Point `DATABASE_URL` and `REDIS_URL` at managed services

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Prisma client missing | `npm run db:generate` from root |
| CORS errors | Ensure `FRONTEND_URL=http://localhost:3000` in `.env` |
| Redis connection errors | Start Redis via docker compose, or leave `REDIS_URL` unset (some features degrade) |
| Upload failures | Ensure `services/api/uploads` exists and is writable |

## Local accounts

Create accounts through the API registration flow. This copy contains no demo seed accounts.

## Illustrative plot images

To assign a lightweight local SVG illustration to every land record that does not already have an image URL, run:

```bash
npm run db:seed-demo-images
```

The command preserves existing image URLs and fills only missing plot images using the bundled demo SVGs. It also assigns district-level coordinates to the bundled demo plots only when coordinates are missing. The Explore page labels these as approximate and does not offer directions to them. These images and map pins are illustrative placeholders, not photographs, surveyed boundaries, or exact land locations. Replace them with verified parcel coordinates before using real land records.

## Live features connected to API

- Map + land list ← `GET /api/v1/lands`
- Projects ← `GET /api/v1/projects`
- Register / Login ← `POST /api/v1/auth/register|login` (JWT in localStorage)
- Site visit form ← `POST /api/v1/engagement/site-visits`
- Contact dealer ← `POST /api/v1/engagement/enquiries`
- Write review ← `POST /api/v1/engagement/reviews`

## Aadhaar authentication

Real Aadhaar authentication is unavailable until an authorized Aadhaar e-KYC provider is configured. The legacy Aadhaar OTP endpoints return `503` and do not store Aadhaar numbers or mark users verified. Phone confirmation OTP is separate and does not verify Aadhaar or legal identity. Never collect Aadhaar numbers through the demo form.

Swagger: http://localhost:4000/api/v1/docs
