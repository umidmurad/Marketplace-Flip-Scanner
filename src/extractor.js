(function (root) {
  "use strict";

  const DEBUG_PREFIX = "[Marketplace Flip Scanner]";
  const PANEL_ID = "mfs-stage-one-panel";

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

    const headingCandidates = Array.from(root.document.querySelectorAll("h1, [role='heading'][aria-level='1'], [role='heading']"))
      .filter((element) => !isInsideExtensionPanel(element))
      .map((element) => normalizeText(element.textContent))
      .filter(Boolean)
      .filter((text) => !/facebook|marketplace|notifications|menu/i.test(text));

    if (headingCandidates.length > 0) {
      debug("Title found in visible heading.", headingCandidates[0]);
      return headingCandidates[0];
    }

    const documentTitle = cleanTitle(root.document.title);
    if (documentTitle && !/^facebook$/i.test(documentTitle)) {
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
