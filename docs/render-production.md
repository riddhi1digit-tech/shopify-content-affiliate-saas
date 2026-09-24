# Render production deployment

The app uses a Render Docker web service, Neon PostgreSQL, and Resend. Do not deploy the local `.env` file or reuse temporary `trycloudflare.com` URLs.

## 1. Create the Render service

Connect the repository to Render and use the included `render.yaml`. Add the secret environment values prompted by the blueprint:

- `DATABASE_URL`: Neon pooled connection string (the hostname normally contains `-pooler`).
- `DIRECT_URL`: Neon direct/unpooled connection string for Prisma migrations.
- `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET`: values for this Shopify app.
- `SHOPIFY_APP_URL`: the final Render HTTPS URL, without a trailing slash.
- `RESEND_API_KEY`: a private sending key.
- `AFFILIATE_EMAIL_FROM`: a sender on a verified Resend domain.

The container runs the reviewed Prisma migrations before starting the server. Use a dedicated Neon database and never run `migrate reset` against production.

## 2. Configure Shopify's production URL

After Render assigns the stable HTTPS URL, update `shopify.app.toml`:

```toml
application_url = "https://YOUR-SERVICE.onrender.com"

[auth]
redirect_urls = [
  "https://YOUR-SERVICE.onrender.com/auth/callback",
  "https://YOUR-SERVICE.onrender.com/auth/shopify/callback",
  "https://YOUR-SERVICE.onrender.com/api/auth/callback"
]
```

Keep the access scopes, webhook subscriptions, and app proxy settings already present in the file. Then validate locally and deploy the Shopify configuration and theme extension:

```powershell
pnpm run typecheck
pnpm run build
pnpm run deploy
```

`shopify app deploy` releases Shopify-managed configuration and extensions; Render deploys the web application separately. Added scopes require merchant approval when the app is opened.

## 3. Production verification

1. Open the embedded app and approve any requested scopes.
2. Sync the catalog.
3. Create an active affiliate and campaign.
4. Open the campaign link in a private browser and verify click tracking and coupon application.
5. Complete a test order and verify the `orders/create` attribution.
6. Refund the unpaid test commission and confirm it becomes `REVERSED`.
7. Request an affiliate portal email and confirm its link uses the Render domain.
