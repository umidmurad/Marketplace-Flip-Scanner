(function (root) {
  "use strict";

  const DEFAULT_PROFIT_SETTINGS = {
    feeProfile: "auto",
    ebayFeePercent: 0,
    promotedListingPercent: 0,
    buyerShippingChargedMode: "auto",
    buyerShippingCharged: 0,
    salesTaxPercent: 0,
    shippingExpense: 0,
    packagingExpense: 0,
    otherExpense: 0
  };

  const FEE_PROFILES = [
    {
      id: "auto",
      label: "Auto suggestion",
      percent: null,
      keywords: []
    },
    {
      id: "most",
      label: "Most categories",
      percent: 13.6,
      keywords: []
    },
    {
      id: "media",
      label: "Books / movies / music",
      percent: 15.3,
      keywords: ["book", "books", "dvd", "blu-ray", "movie", "movies", "cd", "vinyl", "record", "album"]
    },
    {
      id: "electronics",
      label: "Consumer electronics",
      percent: 13.6,
      keywords: ["anker", "battery", "camera", "charger", "computer", "headphone", "iphone", "laptop", "monitor", "phone", "tablet"]
    },
    {
      id: "camera",
      label: "Camera / photo",
      percent: 9.35,
      keywords: ["canon", "camera", "dslr", "fujifilm", "lens", "nikon", "sony alpha"]
    },
    {
      id: "cellphone",
      label: "Cell phones",
      percent: 9.35,
      keywords: ["iphone", "pixel", "samsung galaxy", "smartphone"]
    },
    {
      id: "manual",
      label: "Manual",
      percent: null,
      keywords: []
    }
  ];

  function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function roundMoney(value) {
    return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
  }

  function calculateProfitability(inputs) {
    const purchasePrice = toNumber(inputs.purchasePrice);
    const expectedSalePrice = toNumber(inputs.expectedSalePrice);
    const buyerShippingCharged = toNumber(inputs.buyerShippingCharged);
    const salesTaxPercent = toNumber(inputs.salesTaxPercent);
    const ebayFeePercent = toNumber(inputs.ebayFeePercent);
    const promotedListingPercent = toNumber(inputs.promotedListingPercent);
    const shippingExpense = toNumber(inputs.shippingExpense);
    const packagingExpense = toNumber(inputs.packagingExpense);
    const otherExpense = toNumber(inputs.otherExpense);
    const estimatedSalesTax = (expectedSalePrice + buyerShippingCharged) * (salesTaxPercent / 100);
    const feeBase = expectedSalePrice + buyerShippingCharged + estimatedSalesTax;
    const ebaySellingFees = feeBase * (ebayFeePercent / 100);
    const promotedListingFees = feeBase * (promotedListingPercent / 100);
    const grossReceived = expectedSalePrice + buyerShippingCharged;
    const otherSellingExpenses = shippingExpense + packagingExpense + otherExpense + promotedListingFees;
    const expectedNetProceeds = grossReceived - ebaySellingFees - otherSellingExpenses;
    const expectedProfit = expectedNetProceeds - purchasePrice;
    const roiPercent = purchasePrice > 0 ? (expectedProfit / purchasePrice) * 100 : null;

    return {
      purchasePrice: roundMoney(purchasePrice),
      expectedSalePrice: roundMoney(expectedSalePrice),
      buyerShippingCharged: roundMoney(buyerShippingCharged),
      estimatedSalesTax: roundMoney(estimatedSalesTax),
      feeBase: roundMoney(feeBase),
      ebaySellingFees: roundMoney(ebaySellingFees),
      promotedListingFees: roundMoney(promotedListingFees),
      shippingExpense: roundMoney(shippingExpense),
      packagingExpense: roundMoney(packagingExpense),
      otherExpense: roundMoney(otherExpense),
      otherSellingExpenses: roundMoney(otherSellingExpenses),
      expectedNetProceeds: roundMoney(expectedNetProceeds),
      expectedProfit: roundMoney(expectedProfit),
      roiPercent: roiPercent === null ? null : Math.round((roiPercent + Number.EPSILON) * 10) / 10
    };
  }

  function mergeSettings(settings) {
    const merged = {
      ...DEFAULT_PROFIT_SETTINGS,
      ...(settings || {})
    };

    if (!merged.buyerShippingChargedMode) {
      merged.buyerShippingChargedMode = "auto";
    }

    return merged;
  }

  function suggestFeeProfile(title) {
    const normalizedTitle = String(title || "").toLowerCase();
    const matchedProfile = FEE_PROFILES
      .filter((profile) => profile.keywords.length > 0)
      .map((profile) => ({
        profile,
        score: profile.keywords.filter((keyword) => normalizedTitle.includes(keyword)).length
      }))
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score || a.profile.keywords.length - b.profile.keywords.length)[0];

    return matchedProfile ? matchedProfile.profile : FEE_PROFILES.find((profile) => profile.id === "most");
  }

  function getFeeProfile(id) {
    return FEE_PROFILES.find((profile) => profile.id === id) || FEE_PROFILES[0];
  }

  root.MFSProfitability = {
    DEFAULT_PROFIT_SETTINGS,
    FEE_PROFILES,
    calculateProfitability,
    getFeeProfile,
    mergeSettings,
    roundMoney,
    suggestFeeProfile,
    toNumber
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.MFSProfitability;
  }
})(typeof window !== "undefined" ? window : globalThis);
