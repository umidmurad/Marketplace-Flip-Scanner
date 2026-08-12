(function (root) {
  "use strict";

  const EBAY_SEARCH_BASE_URL = "https://www.ebay.com/sch/i.html";

  function normalizeText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function stripPriceText(value) {
    return normalizeText(value).replace(/(?:\$|USD\s*)\s?[\d,]+(?:\.\d{2})?/gi, " ");
  }

  function normalizeSearchQuery(title) {
    return stripPriceText(title)
      .replace(/\b(new|used)\b\s*$/i, "")
      .replace(/\s*\|\s*Facebook Marketplace\s*$/i, "")
      .replace(/\s*-\s*Facebook Marketplace\s*$/i, "")
      .replace(/\s*Marketplace\s*$/i, "")
      .replace(/[|•]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildSoldListingsSearchUrl(listingInfo) {
    const query = normalizeSearchQuery(listingInfo && listingInfo.title);

    if (!query) {
      throw new Error("Cannot open eBay search without a listing title.");
    }

    const params = new URLSearchParams({
      _nkw: query,
      LH_Complete: "1",
      LH_Sold: "1",
      _sop: "13",
      _ipg: "60"
    });

    return `${EBAY_SEARCH_BASE_URL}?${params.toString()}`;
  }

  root.MFSEbaySearch = {
    buildSoldListingsSearchUrl,
    normalizeSearchQuery
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.MFSEbaySearch;
  }
})(typeof window !== "undefined" ? window : globalThis);
