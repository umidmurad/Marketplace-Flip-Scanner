(function (root) {
  "use strict";

  const DEBUG_PREFIX = "[Marketplace Flip Scanner]";
  const PANEL_ID = "mfs-stage-one-panel";
  const NON_LISTING_TITLE_TEXT = new Set([
    "ad",
    "buying",
    "categories",
    "chats",
    "create multiple listings",
    "create new listing",
    "details",
    "inbox",
    "listed",
    "location",
    "marketplace",
    "menu",
    "message",
    "notifications",
    "saved",
    "seller details",
    "seller information",
    "selling"
  ]);

  function debug(message, data) {
    if (data === undefined) {
      console.debug(DEBUG_PREFIX, message);
      return;
    }

    console.debug(DEBUG_PREFIX, message, data);
  }

  function warn(message, data) {
    if (data === undefined) {
      console.warn(DEBUG_PREFIX, message);
      return;
    }

    console.warn(DEBUG_PREFIX, message, data);
  }

  function normalizeText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function isVisible(element) {
    if (!element) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    const styles = root.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && styles.visibility !== "hidden" && styles.display !== "none";
  }

  function isInsideExtensionPanel(element) {
    return Boolean(element && typeof element.closest === "function" && element.closest(`#${PANEL_ID}`));
  }

  function getMetaContent(selectors) {
    for (const selector of selectors) {
      const element = root.document.querySelector(selector);
      const content = normalizeText(element && element.getAttribute("content"));

      if (content) {
        return content;
      }
    }

    return "";
  }

  function cleanTitle(value) {
    return normalizeText(value)
      .replace(/\s*\|\s*Facebook Marketplace\s*$/i, "")
      .replace(/\s*-\s*Facebook Marketplace\s*$/i, "")
      .replace(/\s*Marketplace\s*$/i, "")
      .trim();
  }

  function isNonListingTitleText(value) {
    const text = normalizeText(value).toLowerCase();

    return !text || NON_LISTING_TITLE_TEXT.has(text);
  }

  function isLikelyListingTitle(value) {
    const text = cleanTitle(value);

    if (isNonListingTitleText(text)) {
      return false;
    }

    if (text.length < 8 || text.length > 140) {
      return false;
    }

    if (!/[a-z]/i.test(text)) {
      return false;
    }

    if (/^(hi,\s*)?is this available\??$/i.test(text)) {
      return false;
    }

    if (/^(listed|joined|send seller|seller|condition|free pickup|pickup|within)\b/i.test(text)) {
      return false;
    }

    if (/^\$?\d[\d,.]*(?:\s*-\s*\$?\d[\d,.]*)?$/.test(text)) {
      return false;
    }

    return true;
  }

  function scoreTitleCandidate(element, text) {
    const rect = element.getBoundingClientRect();
    const tagName = String(element.tagName || "").toLowerCase();
    const role = String(element.getAttribute && element.getAttribute("role") || "").toLowerCase();
    const ariaLevel = String(element.getAttribute && element.getAttribute("aria-level") || "");
    const viewportWidth = root.innerWidth || root.document.documentElement.clientWidth || 1200;
    let score = 0;

    if (tagName === "h1") {
      score += 80;
    } else if (tagName === "h2") {
      score += 45;
    } else if (role === "heading" && ariaLevel === "1") {
      score += 70;
    } else if (role === "heading") {
      score += 35;
    }

    if (rect.left > viewportWidth * 0.45) {
      score += 45;
    } else if (rect.left < viewportWidth * 0.28) {
      score -= 70;
    }

    if (/\b(model|with|w\/|new|used|open box|scanner|charger|power|bank)\b/i.test(text)) {
      score += 20;
    }

    if (/\d/.test(text)) {
      score += 12;
    }

    score += Math.min(text.length, 80) / 4;
    score -= Math.max(0, text.length - 90) / 2;
    return score;
  }

  function getVisibleTitleCandidates(selector) {
    return Array.from(root.document.querySelectorAll(selector))
      .filter((element) => !isInsideExtensionPanel(element))
      .filter(isVisible)
      .map((element) => ({
        element,
        text: cleanTitle(element.textContent)
      }))
      .filter((candidate) => isLikelyListingTitle(candidate.text))
      .map((candidate) => ({
        ...candidate,
        score: scoreTitleCandidate(candidate.element, candidate.text)
      }))
      .sort((a, b) => b.score - a.score);
  }

  function titleFromDescriptionText(value) {
    const text = normalizeText(value);

    if (!text || text.length < 20) {
      return "";
    }

    const firstSentence = cleanTitle(text.split(/(?<=[.!?])\s+/)[0]).replace(/[.!?]+$/, "");
    const withoutTrailingCondition = firstSentence.replace(/\s+(good|great|excellent|fair|poor)\s+condition\.?$/i, "");

    return isLikelyListingTitle(withoutTrailingCondition) ? withoutTrailingCondition : "";
  }

  function getTitle() {
    const metaTitle = cleanTitle(
      getMetaContent([
        "meta[property='og:title']",
        "meta[name='twitter:title']",
        "meta[name='title']"
      ])
    );

    if (metaTitle && !/^facebook$/i.test(metaTitle)) {
      debug("Title found in metadata.", metaTitle);
      return metaTitle;
    }

    const headingCandidates = getVisibleTitleCandidates("h1, h2, [role='heading'][aria-level='1'], [role='heading']");

    if (headingCandidates.length > 0) {
      debug("Title found in visible heading.", headingCandidates[0]);
      return headingCandidates[0].text;
    }

    const descriptionCandidates = Array.from(root.document.querySelectorAll("div, span, [dir='auto']"))
      .filter((element) => !isInsideExtensionPanel(element))
      .filter(isVisible)
      .map((element) => {
        const text = titleFromDescriptionText(element.textContent);

        return {
          element,
          text,
          score: text ? scoreTitleCandidate(element, text) - 20 : -Infinity
        };
      })
      .filter((candidate) => candidate.text);

    if (descriptionCandidates.length > 0) {
      debug("Title inferred from listing description.", descriptionCandidates[0]);
      return descriptionCandidates[0].text;
    }

    const documentTitle = cleanTitle(root.document.title);
    if (isLikelyListingTitle(documentTitle) && !/^facebook$/i.test(documentTitle)) {
      debug("Title found in document.title.", documentTitle);
      return documentTitle;
    }

    warn("Unable to extract title.");
    return "";
  }

  function parsePriceText(text) {
    const normalized = normalizeText(text);
    const match = normalized.match(/(?:\$|USD\s*)\s?[\d,]+(?:\.\d{2})?/i);
    return match ? match[0].replace(/\s+/g, " ") : "";
  }

  function getAskingPrice() {
    const metaDescription = getMetaContent([
      "meta[property='og:description']",
      "meta[name='description']",
      "meta[name='twitter:description']"
    ]);
    const metaPrice = parsePriceText(metaDescription);

    if (metaPrice) {
      debug("Price found in metadata.", metaPrice);
      return metaPrice;
    }

    const candidates = Array.from(root.document.querySelectorAll("span, div, h1, h2, strong"))
      .filter((element) => !isInsideExtensionPanel(element))
      .filter(isVisible)
      .map((element) => parsePriceText(element.textContent))
      .filter(Boolean);

    if (candidates.length > 0) {
      debug("Price found in visible text.", candidates[0]);
      return candidates[0];
    }

    warn("Unable to extract asking price.");
    return "";
  }

  function isLikelyListingImage(image) {
    if (!image || (!image.currentSrc && !image.src)) {
      return false;
    }

    const src = image.currentSrc || image.src;
    const alt = normalizeText(image.alt);
    const rect = image.getBoundingClientRect();
    const minRenderedSize = rect.width >= 180 && rect.height >= 140;
    const minNaturalSize = image.naturalWidth >= 300 && image.naturalHeight >= 200;
    const looksLikeUiAsset = /emoji|profile|avatar|static\./i.test(src);

    return src.startsWith("http") && !looksLikeUiAsset && (minRenderedSize || minNaturalSize || alt.length > 20);
  }

  function getMainImageUrl() {
    const metaImage = getMetaContent([
      "meta[property='og:image']",
      "meta[name='twitter:image']"
    ]);

    if (metaImage) {
      debug("Image found in metadata.", metaImage);
      return metaImage;
    }

    const images = Array.from(root.document.images)
      .filter((image) => !isInsideExtensionPanel(image))
      .filter(isVisible)
      .filter(isLikelyListingImage)
      .map((image) => {
        const rect = image.getBoundingClientRect();
        return {
          src: image.currentSrc || image.src,
          score: rect.width * rect.height + image.naturalWidth * image.naturalHeight
        };
      })
      .sort((a, b) => b.score - a.score);

    if (images.length > 0) {
      debug("Image found by visible size heuristic.", images[0].src);
      return images[0].src;
    }

    warn("Unable to extract main image URL.");
    return "";
  }

  function extractListingInfo() {
    const info = {
      title: getTitle(),
      askingPrice: getAskingPrice(),
      mainImageUrl: getMainImageUrl(),
      listingUrl: root.location.href
    };

    debug("Extraction result.", info);
    return info;
  }

  root.MFSListingExtractor = {
    cleanTitle,
    extractListingInfo,
    getAskingPrice,
    getMainImageUrl,
    getTitle,
    normalizeText,
    parsePriceText
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.MFSListingExtractor;
  }
})(typeof window !== "undefined" ? window : globalThis);
