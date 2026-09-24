import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { markMerchantUninstalled } from "../models/merchant-onboarding.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Safe when Shopify retries the webhook or the session is already gone.
  await markMerchantUninstalled(session?.shop ?? shop);

  return new Response();
};
