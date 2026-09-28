type WebhookLogValue = string | number | boolean | null | undefined;

export function logWebhook(
  request: Request,
  event: string,
  details: Record<string, WebhookLogValue> = {},
  level: "info" | "error" = "info",
) {
  const entry = JSON.stringify({
    component: "shopify_webhook",
    event,
    webhookId: request.headers.get("x-shopify-webhook-id") ?? undefined,
    eventId: request.headers.get("x-shopify-event-id") ?? undefined,
    ...details,
  });

  if (level === "error") console.error(entry);
  else console.info(entry);
}
