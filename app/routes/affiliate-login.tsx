import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs } from "react-router";
import { Form, useActionData, redirect, useNavigation } from "react-router";
import { requestAffiliateLogin } from "../models/affiliate-login-request.server";
import { checkOrigin, privateHeaders, redeemAffiliateInvite } from "../models/affiliate-access.server";

export const headers = privateHeaders;
export async function action({ request }: ActionFunctionArgs) {
  checkOrigin(request);
  const form = await request.formData();
  if (form.get("intent") === "request") {
    const message = await requestAffiliateLogin(String(form.get("shop") ?? ""), String(form.get("email") ?? ""), new URL(process.env.SHOPIFY_APP_URL || request.url).origin);
    return { message, error: undefined };
  }
  try {
    const sessionCookie = await redeemAffiliateInvite(String(form.get("token") ?? ""));
    return redirect("/affiliate-portal", { headers: { ...privateHeaders(), "Set-Cookie": sessionCookie } });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to sign in.", message: undefined };
  }
}
export default function AffiliateLogin() {
  const [token, setToken] = useState("");
  const tokenRead = useRef(false);
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  useEffect(() => {
    // Development may replay effects. Never overwrite the captured token after
    // removing its fragment from the address bar.
    if (tokenRead.current) return;
    tokenRead.current = true;
    setToken(new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "");
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  }, []);
  return <main className="affiliate-shell affiliate-auth-shell">
    <section className="affiliate-auth-card">
      <div className="affiliate-brand-mark" aria-hidden="true">CA</div>
      <p className="affiliate-eyebrow">Content Affiliate Hub</p>
      <h1>Affiliate sign-in</h1>
      <p className="affiliate-lead">Access your campaign links, tracked results, and commission history.</p>
      {result?.error ? <div className="affiliate-alert affiliate-alert--error" role="alert">{result.error}</div> : null}
      {result?.message ? <div className="affiliate-alert affiliate-alert--success" role="status">{result.message}</div> : null}
      {token ? <Form method="post" className="affiliate-form affiliate-token-form">
        <input type="hidden" name="token" value={token} />
        <p>Your secure link is ready. It can be used once and expires after 30 minutes.</p>
        <button className="affiliate-button affiliate-button--primary" type="submit" disabled={navigation.state !== "idle"}>Sign in to my dashboard</button>
      </Form> : <>
        <div className="affiliate-divider"><span>Request access</span></div>
        <p className="affiliate-helper">For approved or active affiliates. We’ll send a secure, one-time link to your registered email.</p>
        <Form method="post" className="affiliate-form">
          <input type="hidden" name="intent" value="request" />
          <label><span>Store address</span><input name="shop" placeholder="your-store.myshopify.com" required maxLength={100} autoCapitalize="none" spellCheck={false} /></label>
          <label><span>Affiliate email</span><input name="email" type="email" placeholder="you@example.com" autoComplete="email" required maxLength={254} /></label>
          <button className="affiliate-button affiliate-button--primary" type="submit" disabled={navigation.state !== "idle"}>{navigation.state !== "idle" ? "Sending…" : "Email me a sign-in link"}</button>
        </Form>
      </>}
      <p className="affiliate-security-note">Secure link · 30-minute expiry · One-time use</p>
    </section>
  </main>;
}
