(function (root) {
  "use strict";

  const STOP_WORDS = new Set([
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "by",
    "for",
    "from",
    "in",
    "new",
    "of",
    "on",
    "or",
    "the",
    "to",
    "used",
    "with"
  ]);

  function normalizeText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function tokenizeTitle(title) {
    return normalizeText(title)
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
      .filter((token) => !STOP_WORDS.has(token));
  }

  function parseMoney(value) {
    const text = normalizeText(value);

    if (!text || /free/i.test(text)) {
      return /free/i.test(text) ? 0 : null;
    }

    const rangeMatch = text.match(/\$?\s*([\d,]+(?:\.\d{2})?)\s+to\s+\$?\s*([\d,]+(?:\.\d{2})?)/i);
    if (rangeMatch) {
      const low = Number(rangeMatch[1].replace(/,/g, ""));
      const high = Number(rangeMatch[2].replace(/,/g, ""));
      return Number.isFinite(low) && Number.isFinite(high) ? (low + high) / 2 : null;
    }

    const match = text.match(/(?:US\s*)?\$?\s*([\d,]+(?:\.\d{2})?)/i);
    if (!match) {
      return null;
    }

    const amount = Number(match[1].replace(/,/g, ""));
    return Number.isFinite(amount) ? amount : null;
  }

  function formatMoney(value) {
    if (!Number.isFinite(value)) {
      return "";
    }

    return `$${value.toFixed(2)}`;
  }

  function parseSaleDateTimestamp(value) {
    const text = normalizeText(value).replace(/,$/, "");

    if (!text) {
      return null;
    }

    const hasYear = /\b\d{4}\b/.test(text);
    const parseTarget = hasYear ? text : `${text}, ${new Date().getFullYear()}`;
    const timestamp = Date.parse(parseTarget);

    return Number.isFinite(timestamp) ? timestamp : null;
  }

  function median(values) {
    if (!values.length) {
      return null;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);

    if (sorted.length % 2) {
      return sorted[middle];
    }

    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function average(values) {
    if (!values.length) {
      return null;
    }

    return values.reduce((total, value) => total + value, 0) / values.length;
  }

  function getIqrBounds(values) {
    if (values.length < 4) {
      return { low: -Infinity, high: Infinity };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const midpoint = Math.floor(sorted.length / 2);
    const lowerHalf = sorted.slice(0, midpoint);
    const upperHalf = sorted.length % 2 ? sorted.slice(midpoint + 1) : sorted.slice(midpoint);
    const q1 = median(lowerHalf);
    const q3 = median(upperHalf);
    const iqr = q3 - q1;
    const center = median(sorted);

    return {
      low: Math.max(0, q1 - iqr * 1.5, center / 3),
      high: Math.min(q3 + iqr * 1.5, center * 3)
    };
  }

  function scoreComparable(targetTitle, compTitle) {
    const targetTokens = tokenizeTitle(targetTitle);
    const compTokens = tokenizeTitle(compTitle);
    const targetSet = new Set(targetTokens);
    const compSet = new Set(compTokens);
    const matchedTokens = targetTokens.filter((token) => compSet.has(token));
    const modelTokens = targetTokens.filter((token) => /\d/.test(token));
    const matchedModelTokens = modelTokens.filter((token) => compSet.has(token));

    if (!targetTokens.length || !compTokens.length) {
      return {
        score: 0,
        matchedTokens: [],
        reason: "Missing title tokens"
      };
    }

    const overlap = matchedTokens.length / targetSet.size;
    const modelBonus = modelTokens.length ? matchedModelTokens.length / modelTokens.length : 0;
    const score = Math.min(1, overlap * 0.8 + modelBonus * 0.2);

    return {
      score,
      matchedTokens: [...new Set(matchedTokens)],
      reason: score >= 0.45 ? "Token match" : "Low title similarity"
    };
  }

  function enrichComparable(listingInfo, comp) {
    const priceValue = parseMoney(comp.soldPrice);
    const shippingValue = parseMoney(comp.shippingPrice);
    const similarity = scoreComparable(listingInfo && listingInfo.title, comp.title);
    const reasons = [];

    if (!Number.isFinite(priceValue)) {
      reasons.push("Missing sold price");
    }

    if (similarity.score < 0.45) {
      reasons.push(similarity.reason);
    }

    return {
      ...comp,
      soldPriceValue: priceValue,
      shippingPriceValue: shippingValue,
      similarityScore: similarity.score,
      matchedTokens: similarity.matchedTokens,
      isComparable: reasons.length === 0,
      exclusionReasons: reasons
    };
  }

  function summarizePrices(comps) {
    const comparable = comps.filter((comp) => comp.isComparable && Number.isFinite(comp.soldPriceValue));
    const prices = comparable.map((comp) => comp.soldPriceValue);
    const bounds = getIqrBounds(prices);
    const filtered = comparable.map((comp) => {
      const isOutlier = comp.soldPriceValue < bounds.low || comp.soldPriceValue > bounds.high;

      return {
        ...comp,
        isOutlier,
        isUsedForStats: !isOutlier,
        exclusionReasons: isOutlier ? [...comp.exclusionReasons, "Price outlier"] : comp.exclusionReasons
      };
    });
    const byUrl = new Map(filtered.map((comp) => [comp.listingUrl, comp]));
    const allComps = sortCompsForDisplay(comps.map((comp) => byUrl.get(comp.listingUrl) || comp));
    const statsPrices = allComps
      .filter((comp) => comp.isUsedForStats)
      .map((comp) => comp.soldPriceValue);
    const statsShippingPrices = allComps
      .filter((comp) => comp.isUsedForStats && Number.isFinite(comp.shippingPriceValue))
      .map((comp) => comp.shippingPriceValue);

    return {
      comps: allComps,
      stats: {
        compCount: statsPrices.length,
        candidateCount: comps.length,
        comparableCount: comparable.length,
        outlierCount: allComps.filter((comp) => comp.isOutlier).length,
        medianSoldPrice: median(statsPrices),
        averageSoldPrice: average(statsPrices),
        lowestSoldPrice: statsPrices.length ? Math.min(...statsPrices) : null,
        highestSoldPrice: statsPrices.length ? Math.max(...statsPrices) : null,
        medianShippingPrice: median(statsShippingPrices),
        averageShippingPrice: average(statsShippingPrices),
        shippingCompCount: statsShippingPrices.length
      }
    };
  }

  function analyzeComps(listingInfo, rawComps) {
    const enriched = (rawComps || []).map((comp) => enrichComparable(listingInfo || {}, comp));
    return summarizePrices(enriched);
  }

  function sortCompsForDisplay(comps) {
    return [...comps].sort((a, b) => {
      const aExcluded = !a.isUsedForStats;
      const bExcluded = !b.isUsedForStats;

      if (aExcluded !== bExcluded) {
        return aExcluded ? 1 : -1;
      }

      const aTimestamp = parseSaleDateTimestamp(a.saleDate);
      const bTimestamp = parseSaleDateTimestamp(b.saleDate);

      if (aTimestamp !== bTimestamp) {
        if (aTimestamp === null) {
          return 1;
        }

        if (bTimestamp === null) {
          return -1;
        }

        return bTimestamp - aTimestamp;
      }

      return (b.similarityScore || 0) - (a.similarityScore || 0);
    });
  }

  root.MFSComps = {
    analyzeComps,
    formatMoney,
    parseMoney,
    parseSaleDateTimestamp,
    scoreComparable,
    sortCompsForDisplay,
    tokenizeTitle
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.MFSComps;
  }
})(typeof window !== "undefined" ? window : globalThis);
