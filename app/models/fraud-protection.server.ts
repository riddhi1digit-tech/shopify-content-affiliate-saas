import db from "../db.server";
import { summarizeFraudRisk } from "./fraud-score";

export type FraudSignal = {
  type:
    | "BLOCKLIST_MATCH"
    | "MISSING_SESSION"
    | "CLICK_NOT_FOUND"
    | "CLICK_EXPIRED"
    | "REFERRAL_SWITCH"
    | "SESSION_VELOCITY";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  score: number;
  reason: string;
  evidence?: Record<string, string | number | boolean | null>;
};

export async function assessOrderRisk(input: {
  organizationId: string;
  affiliateId: string;
  affiliateLinkId: string;
  referralCode: string;
  sessionKey: string;
  click: { id: string; clickedAt: Date } | null;
  attributionDays: number;
}) {
  const now = new Date();
  const activeAfter = new Date(now.getTime() - 10 * 60 * 1000);
  const blockTargets = [input.affiliateId, input.referralCode];
  if (input.sessionKey) blockTargets.push(input.sessionKey);

  const [blocked, recentSessionClicks, switchedReferral] = await Promise.all([
    db.blocklistEntry.findFirst({
      where: {
        organizationId: input.organizationId,
        active: true,
        targetValue: { in: blockTargets },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { kind: true, label: true, targetValue: true },
    }),
    input.sessionKey
      ? db.affiliateClick.count({
          where: {
            organizationId: input.organizationId,
            sessionKey: input.sessionKey,
            clickedAt: { gte: activeAfter },
          },
        })
      : Promise.resolve(0),
    input.sessionKey
      ? db.affiliateClick.findFirst({
          where: {
            organizationId: input.organizationId,
            sessionKey: input.sessionKey,
            affiliateId: { not: input.affiliateId },
          },
          select: { affiliateId: true },
        })
      : Promise.resolve(null),
  ]);

  const signals: FraudSignal[] = [];
  if (blocked) {
    signals.push({
      type: "BLOCKLIST_MATCH",
      severity: "CRITICAL",
      score: 100,
      reason: `${blocked.kind.toLowerCase().replaceAll("_", " ")} is blocklisted.`,
      evidence: { kind: blocked.kind, label: blocked.label ?? null },
    });
  }
  if (!input.sessionKey) {
    signals.push({
      type: "MISSING_SESSION",
      severity: "LOW",
      score: 20,
      reason: "Order has a referral code but no exact storefront session.",
    });
  }
  if (!input.click) {
    signals.push({
      type: "CLICK_NOT_FOUND",
      severity: "MEDIUM",
      score: 30,
      reason: "No matching tracked click was found for this order.",
    });
  } else {
    const clickAgeDays = (now.getTime() - input.click.clickedAt.getTime()) / 86_400_000;
    if (clickAgeDays > input.attributionDays) {
      signals.push({
        type: "CLICK_EXPIRED",
        severity: "HIGH",
        score: 70,
        reason: "The matching click is outside the attribution window.",
        evidence: { clickAgeDays: Math.floor(clickAgeDays), attributionDays: input.attributionDays },
      });
    }
  }
  if (switchedReferral) {
    signals.push({
      type: "REFERRAL_SWITCH",
      severity: "MEDIUM",
      score: 35,
      reason: "The same storefront session used links from multiple affiliates.",
    });
  }
  if (recentSessionClicks >= 10) {
    signals.push({
      type: "SESSION_VELOCITY",
      severity: "MEDIUM",
      score: 30,
      reason: "The session generated an unusually high number of tracked visits.",
      evidence: { clicksInTenMinutes: recentSessionClicks },
    });
  }

  return { ...summarizeFraudRisk(signals), signals };
}
