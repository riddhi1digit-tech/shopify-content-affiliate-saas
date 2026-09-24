import { createHash } from "node:crypto";

export function emailConfiguration() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.AFFILIATE_EMAIL_FROM?.trim();
  if (!apiKey || !from) throw new Error("Configure RESEND_API_KEY and AFFILIATE_EMAIL_FROM before sending login emails.");
  if (/[\r\n]/.test(from)) throw new Error("Invalid sender address.");
  return { apiKey, from };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export async function sendAffiliateLoginEmail(input: {
  email: string; name: string; storeName: string; loginUrl: string;
}) {
  const { apiKey, from } = emailConfiguration();
  const url = new URL(input.loginUrl);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("Email login links require a secure app URL.");
  if (!/^\S+@\S+\.\S+$/.test(input.email) || /[\r\n]/.test(input.email)) throw new Error("Affiliate email address is invalid.");
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json",
        "Idempotency-Key": `affiliate-login-${createHash("sha256").update(input.loginUrl).digest("hex")}`,
      },
      body: JSON.stringify({
        from, to: [input.email], subject: "Your affiliate dashboard sign-in link",
        html: `<h1>Affiliate dashboard sign-in</h1><p>Hello ${escapeHtml(input.name)},</p><p>Sign in to your affiliate dashboard for ${escapeHtml(input.storeName)}.</p><p><a href="${escapeHtml(input.loginUrl)}">Sign in to my dashboard</a></p><p>This private link expires in 30 minutes and can be used once. Do not share it with customers.</p><p>If you did not expect this invitation, ignore this email.</p>`,
        text: `Hello ${input.name},\n\nSign in to your affiliate dashboard for ${input.storeName}:\n${input.loginUrl}\n\nThis private link expires in 30 minutes and can be used once. Do not share it with customers. If unexpected, ignore this email.`,
      }),
    });
    if (!response.ok) throw new Error(`Resend rejected the request (HTTP ${response.status}). Check sender verification and API permissions.`);
    const result = await response.json() as { id?: string };
    if (!result.id) throw new Error("Email submission could not be confirmed.");
    return result.id;
  } catch (error) {
    // Never log provider bodies, bearer credentials, or private sign-in URLs.
    if (error instanceof Error && error.message.startsWith("Resend rejected")) throw error;
    throw new Error("Email submission could not be confirmed. Check Resend logs before retrying; another invitation revokes previous login links and sessions.");
  }
}
