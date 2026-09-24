# Affiliate sign-in emails (Resend)

Set these on the server, or add them to your existing ignored `.env` for local development:

```dotenv
RESEND_API_KEY=your_private_resend_key
AFFILIATE_EMAIL_FROM=Content Affiliate Hub <login@your-verified-domain.com>
```

Replace the sender with an address on your own verified Resend domain. Do not commit keys, paste them into chat, or put them in frontend configuration. Preserve existing `.env` values such as DATABASE_URL.

Restart `shopify app dev` after setting environment values. Shopify CLI supplies SHOPIFY_APP_URL during development; your deployed server must configure its public HTTPS app URL. Development links only work while that dev tunnel is running, and a new tunnel invalidates previously emailed URLs.

In **Affiliates**, select an active/approved affiliate with your own test recipient email. Click **Email private login link**. This sends an actual email to the saved affiliate address. The success message confirms Resend accepted submission, not final delivery; check Resend delivery logs and the recipient's inbox/spam folder.

Open the emailed link and click **Sign in to my dashboard**. The link expires in 30 minutes and is single-use. Reissuing an invitation revokes prior links and sessions. Manual login links remain available without Resend.

Disable click tracking on the Resend sending domain for these authentication emails. Private credentials are in the URL fragment so normal page GET requests do not receive the token. Never share this sign-in link as a customer referral URL.

Affiliates can also visit `/affiliate-login`, enter the store's `.myshopify.com` address and their registered email, and request a new link. Public requests are limited to 3 per store/email, 30 per store, and 100 app-wide per 15-minute window. The response text does not disclose account existence or email-provider failures. Public requests do not revoke existing sessions/invitations; merchant-issued invitations still do. Delivery-status webhooks are not implemented.

Provider failure/timeout: check Resend logs before retrying; a request might have been accepted even if confirmation was lost. Generating another merchant-issued link revokes earlier access. Before production, add edge-level abuse protection/CAPTCHA and queued delivery (synchronous delivery can expose timing differences despite uniform response text).

References: https://resend.com/docs/api-reference/emails/send-email and https://resend.com/docs/dashboard/domains/introduction
