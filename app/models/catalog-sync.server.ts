import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

import db from "../db.server";

type PageInfo = {
  hasNextPage: boolean;
  endCursor: string | null;
};

type ProductNode = {
  id: string;
  title: string;
  handle: string;
  status: string;
  vendor: string;
  productType: string;
  descriptionHtml: string;
};

type CollectionNode = {
  id: string;
  title: string;
  handle: string;
};

type ProductPage = { nodes: ProductNode[]; pageInfo: PageInfo };
type CollectionPage = { nodes: CollectionNode[]; pageInfo: PageInfo };

type CatalogPage = {
  products?: { nodes: ProductNode[]; pageInfo: PageInfo };
  collections?: { nodes: CollectionNode[]; pageInfo: PageInfo };
};

async function fetchPage(
  admin: AdminApiContext,
  resource: "products",
  cursor: string | null,
): Promise<ProductPage>;
async function fetchPage(
  admin: AdminApiContext,
  resource: "collections",
  cursor: string | null,
): Promise<CollectionPage>;
async function fetchPage(
  admin: AdminApiContext,
  resource: "products" | "collections",
  cursor: string | null,
): Promise<ProductPage | CollectionPage> {
  const selection =
    resource === "products"
      ? "id title handle status vendor productType descriptionHtml"
      : "id title handle";
  const response = await admin.graphql(
    `#graphql
      query CatalogPage($cursor: String) {
        ${resource}(first: 100, after: $cursor) {
          nodes { ${selection} }
          pageInfo { hasNextPage endCursor }
        }
      }`,
    { variables: { cursor } },
  );
  const payload = (await response.json()) as {
    data?: CatalogPage;
    errors?: Array<{ message: string }>;
  };

  const page = payload.data?.[resource];
  if (payload.errors?.length || !page) {
    throw new Error(
      payload.errors?.map((error) => error.message).join("; ") ||
        `Shopify returned no ${resource} data`,
    );
  }

  return page;
}

export async function syncCatalog(
  admin: AdminApiContext,
  store: { id: string; organizationId: string },
) {
  let productCursor: string | null = null;
  let collectionCursor: string | null = null;
  let productCount = 0;
  let collectionCount = 0;

  do {
    const page: ProductPage = await fetchPage(admin, "products", productCursor);
    await db.$transaction(
      page.nodes.map((product) =>
        db.product.upsert({
          where: {
            storeId_shopifyId: { storeId: store.id, shopifyId: product.id },
          },
          update: {
            title: product.title,
            handle: product.handle,
            status: product.status,
            vendor: product.vendor,
            productType: product.productType,
            descriptionHtml: product.descriptionHtml,
            syncedAt: new Date(),
          },
          create: {
            organizationId: store.organizationId,
            storeId: store.id,
            shopifyId: product.id,
            title: product.title,
            handle: product.handle,
            status: product.status,
            vendor: product.vendor,
            productType: product.productType,
            descriptionHtml: product.descriptionHtml,
          },
        }),
      ),
    );
    productCount += page.nodes.length;
    productCursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (productCursor);

  do {
    const page: CollectionPage = await fetchPage(
      admin,
      "collections",
      collectionCursor,
    );
    await db.$transaction(
      page.nodes.map((collection) =>
        db.collection.upsert({
          where: {
            storeId_shopifyId: {
              storeId: store.id,
              shopifyId: collection.id,
            },
          },
          update: {
            title: collection.title,
            handle: collection.handle,
            syncedAt: new Date(),
          },
          create: {
            organizationId: store.organizationId,
            storeId: store.id,
            shopifyId: collection.id,
            title: collection.title,
            handle: collection.handle,
          },
        }),
      ),
    );
    collectionCount += page.nodes.length;
    collectionCursor = page.pageInfo.hasNextPage
      ? page.pageInfo.endCursor
      : null;
  } while (collectionCursor);

  await db.store.update({
    where: { id: store.id },
    data: { lastSyncAt: new Date() },
  });

  return { productCount, collectionCount };
}
