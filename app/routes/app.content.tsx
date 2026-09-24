import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";

import db from "../db.server";
import { provisionMerchant } from "../models/merchant-onboarding.server";
import { authenticate } from "../shopify.server";

type WorkflowResult =
  { success: true; message: string } | { success: false; error: string };

async function publishProduct(
  admin: AdminApiContext,
  shopifyId: string,
  title: string,
  descriptionHtml: string,
) {
  const response = await admin.graphql(
    `#graphql
      mutation UpdateProduct($product: ProductUpdateInput!) {
        productUpdate(product: $product) {
          product { id title descriptionHtml }
          userErrors { message }
        }
      }`,
    { variables: { product: { id: shopifyId, title, descriptionHtml } } },
  );
  const payload = (await response.json()) as {
    data?: {
      productUpdate?: {
        product?: { title: string; descriptionHtml: string };
        userErrors: Array<{ message: string }>;
      };
    };
    errors?: Array<{ message: string }>;
  };
  const result = payload.data?.productUpdate;
  const errors = [
    ...(payload.errors?.map(({ message }) => message) ?? []),
    ...(result?.userErrors.map(({ message }) => message) ?? []),
  ];
  if (errors.length || !result?.product) {
    throw new Error(errors.join("; ") || "Shopify did not update the product");
  }
  return result.product;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const store = await provisionMerchant(session.shop);
  const products = await db.product.findMany({
    where: { storeId: store.id },
    orderBy: { title: "asc" },
    select: {
      id: true,
      title: true,
      descriptionHtml: true,
      contentTargets: {
        take: 1,
        orderBy: { content: { updatedAt: "desc" } },
        select: {
          content: {
            select: { title: true, body: true, status: true, updatedAt: true },
          },
        },
      },
    },
  });

  return {
    products: products.map(({ contentTargets, ...product }) => ({
      ...product,
      draft: contentTargets[0]?.content ?? null,
    })),
  };
};

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<WorkflowResult> => {
  const { admin, session } = await authenticate.admin(request);
  const store = await provisionMerchant(session.shop);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "save");
  const productId = String(form.get("productId") ?? "");
  const product = await db.product.findFirst({
    where: { id: productId, storeId: store.id },
  });
  if (!product) return { success: false, error: "Product was not found." };

  const target = await db.contentTarget.findFirst({
    where: { productId: product.id },
    include: { content: true },
    orderBy: { content: { updatedAt: "desc" } },
  });

  try {
    if (intent === "publish") {
      if (!target || target.content.status !== "APPROVED") {
        return {
          success: false,
          error: "Approve this draft before publishing.",
        };
      }
      const updated = await publishProduct(
        admin,
        product.shopifyId,
        target.content.title,
        target.content.body,
      );
      await db.$transaction([
        db.product.update({
          where: { id: product.id },
          data: {
            title: updated.title,
            descriptionHtml: updated.descriptionHtml,
            syncedAt: new Date(),
          },
        }),
        db.content.update({
          where: { id: target.content.id },
          data: { status: "PUBLISHED", publishedAt: new Date() },
        }),
      ]);
      return {
        success: true,
        message: `Published “${updated.title}” to Shopify.`,
      };
    }

    const title = String(form.get("title") ?? "").trim();
    const body = String(form.get("descriptionHtml") ?? "");
    if (!title) return { success: false, error: "Product title is required." };
    const status = intent === "approve" ? "APPROVED" : "DRAFT";

    if (target) {
      const version = await db.contentVersion.count({
        where: { contentId: target.content.id },
      });
      await db.content.update({
        where: { id: target.content.id },
        data: {
          title,
          body,
          status,
          publishedAt: null,
          versions: { create: { version: version + 1, title, body } },
        },
      });
    } else {
      await db.content.create({
        data: {
          organizationId: store.organizationId,
          storeId: store.id,
          type: "PRODUCT_DESCRIPTION",
          title,
          body,
          status,
          targets: { create: { productId: product.id } },
          versions: { create: { version: 1, title, body } },
        },
      });
    }
    return {
      success: true,
      message:
        status === "APPROVED" ? "Draft approved." : "Draft and version saved.",
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Content action failed.",
    };
  }
};

export default function ContentPage() {
  const { products } = useLoaderData<typeof loader>();
  const workflow = useFetcher<typeof action>();
  const busy = workflow.state !== "idle";
  const draftCount = products.filter((product) => product.draft?.status === "DRAFT").length;
  const approvedCount = products.filter((product) => product.draft?.status === "APPROVED").length;
  const publishedCount = products.filter((product) => product.draft?.status === "PUBLISHED").length;

  return (
    <s-page heading="Content workflow">
      <div className="merchant-content-workflow">
        {workflow.data?.success ? (
          <s-banner tone="success">{workflow.data.message}</s-banner>
        ) : workflow.data && !workflow.data.success ? (
          <s-banner tone="critical">{workflow.data.error}</s-banner>
        ) : null}

        <section className="merchant-workflow-hero">
          <div><p className="merchant-eyebrow">Safe publishing</p><h2>Draft, review, then publish</h2><p>Editing and approval happen inside the app. Your Shopify storefront changes only when you publish an approved draft.</p></div>
          <div className="merchant-workflow-steps" aria-label="Publishing workflow">
            <span><b>1</b><small>Draft</small></span><i aria-hidden="true">→</i><span><b>2</b><small>Approve</small></span><i aria-hidden="true">→</i><span><b>3</b><small>Publish</small></span>
          </div>
        </section>

        <section className="merchant-kpi-grid merchant-kpi-grid--compact" aria-label="Content summary">
          <article className="merchant-kpi"><span>Products</span><strong>{products.length}</strong><small>Available to edit</small></article>
          <article className="merchant-kpi merchant-kpi--attention"><span>Drafts</span><strong>{draftCount}</strong><small>Work in progress</small></article>
          <article className="merchant-kpi"><span>Approved</span><strong>{approvedCount}</strong><small>Ready to publish</small></article>
          <article className="merchant-kpi"><span>Published</span><strong>{publishedCount}</strong><small>Live content records</small></article>
        </section>

      {!products.length ? <section className="merchant-card"><div className="merchant-empty">No products found. Return to Home and sync your Shopify catalog.</div></section> : null}
      {products.map((product) => {
        const draft = product.draft;
        const status = draft?.status ?? "NO_DRAFT";
        return (
          <section className="merchant-content-editor" key={product.id}>
            <header className="merchant-content-editor-head">
              <div><p className="merchant-eyebrow">Shopify product</p><h3>{product.title}</h3>{draft?.updatedAt ? <small>Draft updated {new Date(draft.updatedAt).toLocaleString()}</small> : <small>No draft created yet</small>}</div>
              <span className={`merchant-content-status merchant-content-status--${status.toLowerCase()}`}>{status.replace("_", " ")}</span>
            </header>
            <workflow.Form method="post" className="merchant-content-form">
              <input type="hidden" name="productId" value={product.id} />
              <label><span>Product title</span><input name="title" defaultValue={draft?.title ?? product.title} required /></label>
              <label><span>Description <em>HTML supported</em></span><textarea name="descriptionHtml" defaultValue={draft?.body ?? product.descriptionHtml ?? ""} rows={8} /></label>
              <footer className="merchant-content-actions">
                <div><button className="merchant-button merchant-button--secondary" type="submit" name="intent" value="save" disabled={busy}>{busy ? "Saving…" : "Save draft"}</button><button className="merchant-button merchant-button--approve" type="submit" name="intent" value="approve" disabled={busy}>Save and approve</button></div>
                <button className="merchant-button merchant-button--primary" type="submit" name="intent" value="publish" disabled={busy || draft?.status !== "APPROVED"}>Publish to Shopify</button>
              </footer>
            </workflow.Form>
          </section>
        );
      })}
      </div>
    </s-page>
  );
}
