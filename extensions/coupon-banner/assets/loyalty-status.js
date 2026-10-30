document.querySelectorAll("[data-cah-loyalty]").forEach(async (root) => {
  try {
    const response = await fetch("/apps/content-affiliate-hub/loyalty", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error("Rewards unavailable");
    const data = await response.json();
    if (!data.enabled) throw new Error("Rewards unavailable");
    root.querySelector("[data-cah-loyalty-title]").textContent = `${data.balance} ${data.pointsName}`;
    const reward = data.reward;
    root.querySelector("[data-cah-loyalty-detail]").textContent = reward.eligible
      ? `${data.tier} tier · Reward ready: ${reward.currencyCode} ${Number(reward.value).toFixed(2)}`
      : `${data.tier} tier · ${Math.max(0, reward.points - data.balance)} more ${data.pointsName} to your next reward`;
  } catch {
    root.querySelector("[data-cah-loyalty-title]").textContent = "Rewards are temporarily unavailable";
  }
});
