# Classic Trip (single-folder Express + EJS)

Runs everything (pages + API) from one server.

## Run
```bash
npm install
cp .env.example .env
# edit .env with Mongo + JWT + Cloudinary
npm run dev
```

Open:
- http://localhost:3000

## Key features
- Seat maps + hold (TTL) + booking confirm
- Guest bookings (no login) + guest lookup code
- Promotions: share link (?ref=CODE) -> 5% wallet credit
- Wallet redemption (discount on next booking)
- Partner dashboard: occupancy + manifest (includes guests)
- Admin dashboard: stats + users + bookings
