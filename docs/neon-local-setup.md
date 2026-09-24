# Run locally with Neon PostgreSQL

The application still runs on your computer. Neon hosts the database; this is not a production app deployment.

## Protect existing data

Keep the existing SQLite file and a private copy of the previous DATABASE_URL. The PostgreSQL migration creates tables only; it does not copy local products, drafts, affiliates, commissions, sessions, or credentials. Do not delete SQLite, reuse another app's populated database, or run migrate reset/db push --accept-data-loss.

Use a **new empty database** in a dedicated Neon development project or branch. Neon branches can contain copies of existing tables, so a branch alone does not guarantee an empty database.

## Configure connections

Stop `shopify app dev` before regenerating Prisma Client (Windows may lock its engine DLL).

In Neon, use Connect to copy two PostgreSQL URLs for the same empty database:

- DATABASE_URL: pooled connection, usually containing `-pooler` in the hostname.
- DIRECT_URL: direct/unpooled connection with pooling disabled.

Update only database variables in the ignored `.env`; preserve Resend settings. Copy the actual URLs including their required TLS parameters, such as `sslmode=require`. Do not share database passwords or paste the URLs into chat.

```dotenv
DATABASE_URL="postgresql://USER:PASSWORD@POOLED_HOST/DATABASE?sslmode=require"
DIRECT_URL="postgresql://USER:PASSWORD@DIRECT_HOST/DATABASE?sslmode=require"
```

These are placeholders, not valid credentials. Percent-encode special password characters when constructing URLs manually; prefer copying Neon's generated connection strings.

## Initialize and run

```powershell
pnpm run db:validate
pnpm run setup
shopify app dev
```

Setup detects PostgreSQL, generates Client from `prisma/neon/schema.prisma`, and applies the reviewed migrations in `prisma/neon/migrations`. It does not run the SQLite initializer. Development startup also applies pending PostgreSQL migrations. Approve that only for this dedicated development database; avoid using production credentials for local development.

The new database starts with no app data. Shopify authentication provisions its organization/store again; sync the catalog, then create test affiliates and campaigns as needed. Old storefront referral codes and affiliate login sessions belong to the old database and will not work. Existing Shopify coupons may still exist, so use new test coupon codes.

## Verify

Confirm Neon tables include Session, Store, Product, Affiliate, Commission, Payout, AffiliateAccess, and AffiliateLoginLimit. Then test Shopify installation/login, catalog sync, saving a draft, affiliate/campaign creation, tracking, a new test order, refunds, and affiliate email login. Offline tests are not proof of live PostgreSQL behavior.

## Switch back without losing SQLite

Stop dev, restore the old file: DATABASE_URL, and run `pnpm run setup` to regenerate the SQLite client and initialize any missing local tables. DIRECT_URL is ignored in SQLite mode. Restart Shopify dev.

## Maintaining schemas

Keep model/enum changes aligned between `prisma/schema.prisma` (SQLite) and `prisma/neon/schema.prisma` (PostgreSQL). `node scripts/test-database-setup.mjs` checks parity. Use `--schema prisma/neon/schema.prisma` for PostgreSQL-specific Prisma commands; bare Prisma commands default to the SQLite schema.

Sources: https://www.prisma.io/docs/orm/v6/overview/databases/neon and https://neon.com/docs/guides/prisma
