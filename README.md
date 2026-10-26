# BlockLand

Blockchain-backed land registry and property discovery platform.

## Architecture (integrated monorepo)

```
blockland/
├── apps/web/              # Next.js frontend (from scaffold)
├── services/api/          # Full Express + TypeScript backend API
├── packages/contracts/    # Hardhat + LandRegistry.sol
├── prisma/                # Shared Prisma schema (backend source of truth)
├── docker-compose.yml     # Postgres + Redis
└── docs/                  # Project docs + HTML prototype
```

| Layer        | Source                          | Notes                                      |
|--------------|---------------------------------|--------------------------------------------|
| Frontend     | blockland-scaffold              | Next.js App Router, wired to real API      |
| Backend API  | backend.zip                     | Full controllers, auth, transfers, etc.    |
| Database     | backend Prisma schema + PostgreSQL | Shared database schema and local infrastructure |
| Blockchain   | blockchain.zip                  | Hardhat, OpenZeppelin ERC-721 style registry |

## Quick start

```bash
# 1. Install
npm install

# 2. Environment
cp .env.example .env
# Edit secrets if needed (JWT, etc.)

# 3. Infrastructure
docker compose up -d

# 4. Database
npm run db:generate
npm run db:push

# 5. Run (two terminals or use npm run dev)
npm run dev:api    # http://localhost:4000
npm run dev:web    # http://localhost:3000
```

- API Swagger: http://localhost:4000/api/v1/docs  
- Health: http://localhost:4000/health  

## API overview

- `POST /api/v1/auth/register` · `POST /api/v1/auth/login` · `GET /api/v1/auth/me`
- `GET/POST /api/v1/lands`
- `GET/POST /api/v1/transfers`
- `GET/POST /api/v1/projects`
- `GET/POST /api/v1/fractional`
- `GET/POST /api/v1/documents`
- `GET/POST /api/v1/verification` (GOVERNMENT / ADMIN)
- `GET /api/v1/builders` · `GET /api/v1/me` · `GET /api/v1/admin`

Roles: **USER** · **GOVERNMENT** · **ADMIN**

## Contracts

```bash
cd packages/contracts
npm install   # if not using workspaces install
npx hardhat compile
npx hardhat test
npx hardhat run scripts/deploy.js --network hardhat
```

## Notes

- Frontend is intentionally minimal (scaffold). Static Mark 4 prototype is in `docs/prototypes/`.
- Redis is optional but recommended for cache + document worker (BullMQ).
- Auth in the API uses bcryptjs; create accounts through the API registration flow.

See `SETUP.md` for more detail.
