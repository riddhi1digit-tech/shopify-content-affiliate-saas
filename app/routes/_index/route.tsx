import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <span className={styles.eyebrow}>CONTENT AFFILIATE HUB</span>
        <h1 className={styles.heading}>Turn creator referrals into measurable sales.</h1>
        <p className={styles.text}>
          Create affiliate campaigns, issue trackable discount links, review
          commissions, and manage payouts from one Shopify workspace.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Store address</span>
              <input
                className={styles.input}
                type="text"
                name="shop"
                placeholder="your-store.myshopify.com"
                autoComplete="url"
              />
            </label>
            <button className={styles.button} type="submit">
              Continue to Shopify
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Campaign links</strong>
            <span>Create tracked links with automatic Shopify discount codes.</span>
          </li>
          <li>
            <strong>Reliable attribution</strong>
            <span>Connect visits, orders, refunds, and commissions in one place.</span>
          </li>
          <li>
            <strong>Affiliate portal</strong>
            <span>Give every partner a private dashboard for results and links.</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
