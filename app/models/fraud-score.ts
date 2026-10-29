export type FraudScoreSignal = { score: number };

export function summarizeFraudRisk(signals: FraudScoreSignal[]) {
  const score = Math.min(
    100,
    signals.reduce((total, signal) => total + signal.score, 0),
  );
  return {
    score,
    status: score >= 90 ? "BLOCKED" as const : score >= 40 ? "REVIEW" as const : "CLEAR" as const,
    commissionStatus: score >= 40 ? "HELD" as const : "PENDING" as const,
  };
}
