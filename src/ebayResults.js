(function (root) {
  "use strict";

  const DEBUG_PREFIX = "[Marketplace Flip Scanner]";
  const MAX_RESULTS = 30;
  const state = {
    observer: null
  };
  const RESULT_CARD_SELECTOR = [
    "li.s-item",
    "div.s-item",
    "[data-testid='item-card']",
    "[data-testid='ux-card']",
    ".brwrvr__item-card",
    ".s-card"
  ].join(", ");

  function debug(message, data) {
    if (data === undefined) {
      console.debug(DEBUG_PREFIX, message);
      return;
    }

    console.debug(DEBUG_PREFIX, message, data);
  }

  function normalizeText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function getElementText(element) {
    return normalizeText(element && (element.innerText || element.textContent));
  }

  function getTextFromSelectors(container, selectors) {
    for (const selector of selectors) {
      const element = container.querySelector(selector);
      const text = getElementText(element);

      if (text) {
        return text;
      }
    }

    return "";
  }

  function getAllTextFromSelectors(container, selectors) {
    return selectors
      .flatMap((selector) => Array.from(container.querySelectorAll(selector)))
      .map(getElementText)
      .filter(Boolean);
  }

  function cleanItemUrl(value) {
    if (!value) {
      return "";
    }

    try {
      const url = new URL(value);
      return `${url.origin}${url.pathname}`;
    } catch (error) {
      return value;
    }
  }

  function extractSaleDate(container) {
    const text = normalizeText(container.textContent);
    const datePattern = "([A-Z][a-z]{2}\\s+\\d{1,2},?\\s+\\d{4}|[A-Z][a-z]{2}\\s+\\d{1,2}|\\d{1,2}/\\d{1,2}/\\d{2,4})";
    const soldMatch = text.match(new RegExp(`\\bSold\\s+(?:on\\s+)?${datePattern}`, "i"));
    const endedMatch = text.match(new RegExp(`\\bEnded\\s+${datePattern}`, "i"));

    return normalizeText((soldMatch && soldMatch[1]) || (endedMatch && endedMatch[1]) || "");
  }

  function extractShipping(container) {
    const selectorText = getShippingTextFromSelectors(container);
    const text = selectorText || extractShippingFromText(container);

    if (!text) {
      return "";
    }

    if (/\bfree\s+(?:shipping|delivery)\b/i.test(text)) {
      return "Free shipping";
    }

    const match = text.match(/(?:US\s*)?\$[\d,]+(?:\.\d{2})?/i);
    return match ? match[0] : text;
  }

  function getShippingTextFromSelectors(container) {
    const candidates = getAllTextFromSelectors(container, [
      ".s-item__shipping",
      ".s-card__shipping",
      "[data-testid='shipping']",
      "[data-testid='delivery']",
      "[class*='delivery']",
      "[class*='shipping']",
      ".s-card__attribute-row",
      ".s-item__details",
      ".s-item__detail",
      ".su-styled-text"
    ]);

    return candidates.find(hasShippingText) || "";
  }

  function extractShippingFromText(container) {
    const text = getElementText(container);

    if (/\bfree\s+(?:shipping|delivery)\b/i.test(text)) {
      return "Free shipping";
    }

    if (/\b(?:shipping|delivery) not specified\b/i.test(text)) {
      return "Shipping not specified";
    }

    const shippingMatch = text.match(/(?:\+?\s*(?:US\s*)?\$[\d,]+(?:\.\d{2})?)\s+(?:shipping|delivery)/i);
    if (shippingMatch) {
      return shippingMatch[0];
    }

    const plusShippingMatch = text.match(/\+\s*(?:US\s*)?\$[\d,]+(?:\.\d{2})?/i);
    return plusShippingMatch ? `${plusShippingMatch[0]} shipping` : "";
  }

  function hasShippingText(text) {
    return /\bfree\s+(?:shipping|delivery)\b/i.test(text)
      || /\b(?:shipping|delivery) not specified\b/i.test(text)
      || /(?:\+?\s*(?:US\s*)?\$[\d,]+(?:\.\d{2})?)\s*(?:shipping|delivery)/i.test(text);
  }

  function isSoldResult(container) {
    const text = getElementText(container);
    return /\bSold\b/i.test(text) || /(?:LH_Sold|LH_Complete)=1/i.test(root.location.search);
  }

  function scoreResultContainer(container) {
    const text = getElementText(container);

    if (!text) {
      return -Infinity;
    }

    let score = 0;

    if (/\bSold\b/i.test(text)) {
      score += 35;
    }

    if (/(?:US\s*)?\$[\d,]+(?:\.\d{2})?/.test(text)) {
      score += 25;
    }

    if (/\b(?:free\s+)?(?:shipping|delivery)\b/i.test(text)) {
      score += 25;
    }

    if (/\b(?:pre-owned|used|open box|brand new|new)\b/i.test(text)) {
      score += 10;
    }

    if (container.querySelector && container.querySelector("a[href*='/itm/'], a[href*='itm/']")) {
      score += 10;
    }

    if (text.length > 1200) {
      score -= 40;
    }

    return score;
  }

  function getBestAncestorContainer(link) {
    const candidates = [];
    let current = link;
    let depth = 0;

    while (current && depth < 8) {
      candidates.push(current);
      current = current.parentElement;
      depth += 1;
    }

    const closestCard = typeof link.closest === "function"
      ? link.closest(RESULT_CARD_SELECTOR) || link.closest("li") || link.closest("div")
      : null;

    if (closestCard) {
      candidates.push(closestCard);
    }

    return candidates
      .filter(Boolean)
      .map((container) => ({
        container,
        score: scoreResultContainer(container)
      }))
      .sort((a, b) => b.score - a.score)[0]?.container || closestCard || link;
  }

  function getResultContainers() {
    const selectorContainers = Array.from(root.document.querySelectorAll(RESULT_CARD_SELECTOR));
    const linkContainers = Array.from(root.document.querySelectorAll("a[href*='/itm/'], a[href*='itm/']"))
      .map(getBestAncestorContainer)
      .filter(Boolean);
    const containers = [...selectorContainers, ...linkContainers];

    return containers.filter((container, index) => containers.indexOf(container) === index);
  }

  function extractPriceFromText(container) {
    const text = getElementText(container);
    const soldPriceMatch = text.match(/(?:Sold\s+)?(?:for\s+)?((?:US\s*)?\$[\d,]+(?:\.\d{2})?)(?!\s*shipping)/i);

    return soldPriceMatch ? soldPriceMatch[1] : "";
  }

  function getBestLink(container) {
    const links = Array.from(container.querySelectorAll("a[href*='/itm/'], a[href*='itm/']"));
    return links.find((link) => /\/itm\//.test(link.href || "")) || links[0] || null;
  }

  function extractResult(container) {
    const link = getBestLink(container);
    const title = getTextFromSelectors(container, [
      ".s-item__title",
      ".s-item__title span",
      ".s-card__title",
      "[data-testid='item-title']",
      "[role='heading']",
      "a[href*='/itm/']",
      "a[href*='itm/']"
    ]).replace(/^New Listing\s*/i, "");
    const soldPrice = getTextFromSelectors(container, [
      ".s-item__price",
      ".s-card__price",
      "[data-testid='x-price-primary']",
      "[class*='price']"
    ]) || extractPriceFromText(container);
    const condition = getTextFromSelectors(container, [
      ".SECONDARY_INFO",
      ".s-item__subtitle",
      ".s-card__subtitle",
      "[data-testid='item-condition']",
      "[class*='condition']"
    ]);

    const diagnostics = {
      titleCandidates: getAllTextFromSelectors(container, [".s-item__title", ".s-card__title", "[role='heading']"]).slice(0, 3),
      priceCandidates: getAllTextFromSelectors(container, [
        ".s-item__price",
        ".s-card__price",
        "[data-testid='x-price-primary']",
      "[class*='price']"
      ]).slice(0, 3),
      shippingCandidates: getAllTextFromSelectors(container, [
        ".s-item__shipping",
        ".s-card__shipping",
        "[data-testid='shipping']",
        "[data-testid='delivery']",
        "[class*='delivery']",
        "[class*='shipping']"
      ]).slice(0, 3)
    };

    return {
      title,
      soldPrice,
      shippingPrice: extractShipping(container),
      condition,
      saleDate: extractSaleDate(container),
      listingUrl: cleanItemUrl(link && link.href),
      source: "ebay-search",
      diagnostics
    };
  }

  function uniqueByUrl(results) {
    const seen = new Set();
    return results.filter((result) => {
      const key = result.listingUrl || `${result.title}|${result.soldPrice}`;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }

  function extractSoldResults() {
    const containers = getResultContainers();
    const extracted = containers.map(extractResult);
    const results = extracted
      .filter((result, index) => {
        const container = containers[index];
        return isSoldResult(container) && result.title && result.soldPrice && result.listingUrl;
      });

    const uniqueResults = uniqueByUrl(results).slice(0, MAX_RESULTS);
    debug("Extracted eBay sold result candidates.", {
      containerCount: containers.length,
      extractedCount: extracted.length,
      usableCount: uniqueResults.length,
      rejectedSample: extracted
        .filter((result, index) => !(isSoldResult(containers[index]) && result.title && result.soldPrice && result.listingUrl))
        .slice(0, 5)
    });
    return uniqueResults;
  }

  function sendResults(isFinal) {
    const comps = extractSoldResults();

    chrome.runtime.sendMessage({
      type: "MFS_EBAY_RESULTS",
      url: root.location.href,
      comps,
      isFinal: Boolean(isFinal)
    });

    if (isFinal && state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
  }

  function scheduleSend() {
    root.clearTimeout(scheduleSend.timer);
    scheduleSend.timer = root.setTimeout(sendResults, 500);
  }

  function init() {
    if (!/\/sch\/i\.html/.test(root.location.pathname)) {
      return;
    }

    debug("Initializing eBay results extractor.");
    scheduleSend();
    root.setTimeout(() => sendResults(false), 1500);
    root.setTimeout(() => sendResults(false), 3500);
    root.setTimeout(() => sendResults(false), 7000);
    root.setTimeout(() => sendResults(true), 12000);

    state.observer = new MutationObserver(scheduleSend);
    state.observer.observe(root.document.body, {
      childList: true,
      subtree: true
    });
  }

  root.MFSEbayResults = {
    cleanItemUrl,
    extractShipping,
    extractShippingFromText,
    extractSoldResults,
    extractSaleDate,
    getResultContainers
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.MFSEbayResults;
  }

  if (typeof chrome !== "undefined" && chrome.runtime && root.document) {
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
      init();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
