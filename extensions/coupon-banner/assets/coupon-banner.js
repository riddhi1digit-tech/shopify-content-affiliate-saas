(() => {
  if (window.cahCouponInitialized) return;
  window.cahCouponInitialized = true;
  const banners = [...document.querySelectorAll("[data-cah-coupon-banner]")];
  const params = new URLSearchParams(window.location.search);
  const ref = params.get("ref");
  const storage = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* Storage may be blocked. */ } },
  };
  let saved;
  try { saved = JSON.parse(storage.get("cah_campaign") || "null"); } catch { saved = null; }
  if (!saved || saved.expiresAt <= Date.now()) saved = null;
  function render(code, status = "", onlyBanner = null) {
    (onlyBanner ? [onlyBanner] : banners).forEach((banner) => {
      const offer = [banner.querySelector("[data-cah-offer-message]"), banner.querySelector("[data-cah-coupon-code]"), banner.querySelector("[data-cah-copy]")];
      offer.forEach((element) => { if (element) element.hidden = !code; });
      banner.querySelector("[data-cah-coupon-code]").textContent = code || "";
      const tracking = banner.querySelector("[data-cah-tracking-status]");
      tracking.hidden = !status;
      tracking.textContent = status;
      banner.classList.toggle("cah-coupon-banner--hidden", !code && !status);
      banner.dataset.activeCode = code || "";
    });
  }
  banners.forEach((banner) => banner.querySelector("[data-cah-copy]").addEventListener("click", async (event) => {
    try {
      await navigator.clipboard.writeText(banner.dataset.activeCode);
      event.currentTarget.textContent = "Copied";
    } catch { event.currentTarget.textContent = "Please select and copy the code"; }
  }));
  if (!ref) {
    banners.forEach((banner) =>
      render(
        saved ? saved.coupon : banner.dataset.defaultCode,
        saved ? "Affiliate offer active" : "",
        banner,
      ),
    );
    return;
  }
  render("", "Checking affiliate campaign...");
  storage.set("cah_campaign", "null");
  const sessionKey = storage.get("cah_session") || crypto.randomUUID();
  storage.set("cah_session", sessionKey);
  const query = new URLSearchParams({ ref, session: sessionKey, landing: `${window.location.pathname}${window.location.search}`, referrer: document.referrer });
  // A previously counted visit still needs to refresh cart attribution/discount.
  fetch(`/apps/content-affiliate-hub/track?${query}`, { credentials: "same-origin", cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error("Campaign verification failed");
      const campaign = await response.json();
      if (!campaign.tracked || !(campaign.couponCode === null || typeof campaign.couponCode === "string")) throw new Error("Invalid campaign response");
      const coupon = campaign.couponCode || "";
      const root = window.Shopify?.routes?.root || "/";
      const cart = await fetch(`${root}cart/update.js`, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attributes: { _cah_ref: ref }, discount: coupon }),
      });
      if (!cart.ok) throw new Error("Cart referral/discount update failed");
      storage.set("cah_campaign", JSON.stringify({ ref, coupon, expiresAt: Date.now() + 2592000000 }));
      document.cookie = `cah_ref=${encodeURIComponent(ref)}; Max-Age=2592000; Path=/; SameSite=Lax`;
      render(coupon, coupon ? "Affiliate visit tracked" : "Affiliate visit tracked · No campaign coupon");
    })
    .catch((error) => {
      render("", "Campaign/cart update unavailable. Reload before checkout.");
      console.error("Content Affiliate Hub:", error);
    });
})();
