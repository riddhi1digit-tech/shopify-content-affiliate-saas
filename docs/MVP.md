# Content Affiliate Hub - MVP

## Product goal

Build a multi-tenant SaaS application that Shopify merchants install to manage product and collection content, affiliate campaigns, referral attribution, commissions, and manual payout records.

## Provisional decisions

- One Shopify store per organization in the MVP; the schema supports more later.
- English interface; store currency and timezone come from Shopify.
- Affiliate self-registration and admin invitation are both planned.
- Referral links and affiliate coupon codes are both planned.
- Default commission is 10 percent of eligible revenue, excluding tax and shipping.
- Last-click attribution uses a default 30-day window; coupon attribution has priority.
- Payouts are calculated in the platform and paid manually in the MVP.
- Initial publishing targets are product descriptions, collection descriptions, and their metafields.

## Tenant isolation rule

Every merchant-owned query and mutation must be scoped by `organizationId`. A Shopify session identifies the store; the store identifies the organization. Never accept an organization ID from the browser as proof of access.

## Database environments

- Local Shopify development uses SQLite so the app runs without a separate database server.
- Neon PostgreSQL is supported with a separate schema and migration history. Configure pooled DATABASE_URL and unpooled DIRECT_URL, then use the database-aware setup commands; see neon-local-setup.md. SQLite test data is not automatically copied.

## First end-to-end milestone

1. Merchant installs the app.
2. The system creates an organization and connects the store.
3. Products and collections synchronize.
4. Merchant creates and publishes an approved content update.
5. Merchant creates an affiliate and campaign.
6. The system generates a referral link.
7. A click is recorded and later attributed to a Shopify order.
8. The system creates a commission.
9. Merchant records a manual payout.

## Deferred from MVP

- Multiple active stores per subscription
- Automated payouts
- Advanced and multi-touch attribution
- Blogs, pages, theme blocks, and custom app sections
- Multi-language authoring
- AI-assisted content
