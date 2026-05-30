# Classic Trip seed/wallet fix

This copy fixes the marketplace demo seeding failure:

`E11000 duplicate key error collection: classic_trip.wallets index: ownerType_1_ownerId_1 dup key: { ownerType: null, ownerId: null }`

## What changed

- Unified `src/models/wallet.js` and `src/models/shared/wallet.js` so both old controllers and new marketplace APIs use compatible wallet fields.
- Wallets now save both legacy `userId` and current `ownerType`/`ownerId` fields.
- Added safe `mongoose.models.Wallet` / `mongoose.models.WalletTxn` guards to prevent model overwrite errors when old and shared modules are loaded together.
- Updated `src/services/wallet.js` so demo seeding creates wallets with `ownerType` and `ownerId`, not null values.
- Updated shared wallet creation to also set `userId` for compatibility.
- Expanded the root wallet transaction enum to match the shared marketplace transaction types.
- Ran `node --check` on all JavaScript files under `src` and `public`.

## How to use

Copy these files into your project or replace your project with this fixed copy, then run:

```bash
node src/scripts/seedDemo.js
```

If your database already contains bad wallet rows from earlier failed attempts, clean only those rows once:

```bash
mongosh
use classic_trip

db.wallets.deleteMany({
  $or: [
    { ownerId: null },
    { ownerId: { $exists: false } },
    { ownerType: null },
    { ownerType: { $exists: false } }
  ]
})
```

For a full demo reset, you can instead drop only the wallet collection:

```js
use classic_trip
db.wallets.drop()
```

Then rerun:

```bash
node src/scripts/seedDemo.js
```

## Follow-up fix: pre-hook and duplicate index warning

This updated zip also fixes:

`TypeError: next is not a function at model.syncLegacyUserId`

The wallet validation hook now uses Mongoose promise-style middleware instead of calling `next()`.

It also removes the duplicate `userId` index declaration warning by keeping only the schema-level sparse unique index.
