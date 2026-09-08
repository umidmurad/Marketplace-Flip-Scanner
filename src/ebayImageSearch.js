(function (root) {
  "use strict";

  const DEBUG_PREFIX = "[Marketplace Flip Scanner]";
  const ELEMENT_WAIT_MS = 12000;
  const PAGE_READY_RETRIES = 5;

  function debug(message, data) {
    if (data === undefined) {
      console.debug(DEBUG_PREFIX, message);
      return;
    }

    console.debug(DEBUG_PREFIX, message, data);
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function normalizeImageUrl(value) {
    const imageUrl = String(value || "").trim();
    let parsed;

    try {
      parsed = new URL(imageUrl);
    } catch (error) {
      throw new Error("The captured Marketplace image URL is invalid.");
    }

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("The captured image must use an HTTP or HTTPS URL.");
    }

    return parsed.href;
  }

  function getPageStage(value) {
    let url;

    try {
      url = new URL(value);
    } catch (error) {
      return "unknown";
    }

    if (/\/splashui\/challenge/i.test(url.pathname)) {
      return "challenge";
    }

    if (url.pathname === "/sch/i.html" && url.searchParams.has("visualSearchGuid")) {
      if (url.searchParams.get("LH_Complete") === "1" && url.searchParams.get("LH_Sold") === "1") {
        return "sold-results";
      }

      if (url.searchParams.get("LH_Complete") === "1") {
        return "completed-results";
      }

      return "image-results";
    }

    return "search-entry";
  }

  function findCameraButton(documentRef) {
    const direct = documentRef.querySelector([
      "button[aria-label='Camera icon']",
      "button[aria-label*='camera' i]",
      "button[title*='search with an image' i]",
      "button[title*='image search' i]"
    ].join(", "));

    if (direct) {
      return direct;
    }

    return Array.from(documentRef.querySelectorAll("button")).find((button) => {
      const label = normalizeText(`${button.getAttribute("aria-label") || ""} ${button.title || ""} ${button.textContent || ""}`);
      return /(?:camera|search with an image|image search)/i.test(label);
    }) || null;
  }

  function findImageUrlInput(documentRef) {
    return documentRef.querySelector([
      "input[aria-label='Image URL link input']",
      "input[aria-label*='image url' i]",
      "input[placeholder*='paste an image link' i]"
    ].join(", "));
  }

  function findControlByText(documentRef, text, selectors) {
    const expected = normalizeText(text).toLowerCase();

    return Array.from(documentRef.querySelectorAll(selectors || "a, button, label")).find((element) => {
      return normalizeText(element.textContent).toLowerCase() === expected;
    }) || null;
  }

  function waitForElement(findElement, timeoutMs) {
    const startedAt = Date.now();

    return new Promise((resolve, reject) => {
      function check() {
        const element = findElement();

        if (element) {
          resolve(element);
          return;
        }

        if (Date.now() - startedAt >= (timeoutMs || ELEMENT_WAIT_MS)) {
          reject(new Error("Timed out waiting for an eBay page control."));
          return;
        }

        root.setTimeout(check, 150);
      }

      check();
    });
  }

  function setNativeInputValue(input, value) {
    const prototype = root.HTMLInputElement && root.HTMLInputElement.prototype;
    const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, "value");

    if (descriptor && descriptor.set) {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }

    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function watchForLocationChange(previousUrl) {
    let attempts = 0;

    function check() {
      if (root.location.href !== previousUrl) {
        root.setTimeout(() => announceReady(0), 400);
        return;
      }

      attempts += 1;
      if (attempts < 40) {
        root.setTimeout(check, 250);
      }
    }

    root.setTimeout(check, 250);
  }

  function report(type, details) {
    chrome.runtime.sendMessage({
      type,
      url: root.location.href,
      ...details
    });
  }

  function reportProgress(stage, message) {
    debug(message, { stage, url: root.location.href });
    report("MFS_EBAY_IMAGE_PROGRESS", { stage, message });
  }

  function reportError(stage, error, diagnostics) {
    const message = error && error.message ? error.message : String(error || "Unknown image-search error.");

    console.warn(DEBUG_PREFIX, "eBay image search automation failed.", {
      stage,
      message,
      url: root.location.href,
      diagnostics
    });
    report("MFS_EBAY_IMAGE_ERROR", {
      stage,
      message,
      diagnostics: diagnostics || {}
    });
  }

  async function submitImageUrl(imageUrl) {
    const validatedUrl = normalizeImageUrl(imageUrl);
    const cameraButton = await waitForElement(() => findCameraButton(root.document));

    reportProgress("opening-image-dialog", "Opening eBay image search...");
    cameraButton.click();

    const input = await waitForElement(() => findImageUrlInput(root.document));
    setNativeInputValue(input, validatedUrl);

    const goButton = await waitForElement(() => {
      const button = findControlByText(root.document, "Go", "button");
      return button && !button.disabled ? button : null;
    });

    reportProgress("submitting-image", "Submitting the Marketplace image to eBay...");
    watchForLocationChange(root.location.href);
    goButton.click();
  }

  async function applyFilter(label, stage, message) {
    const control = await waitForElement(() => findControlByText(root.document, label, "a, button, label"));

    reportProgress(stage, message);
    watchForLocationChange(root.location.href);
    control.click();
  }

  async function executeAction(response) {
    if (!response || !response.ok || response.action === "ignore") {
      return;
    }

    try {
      if (response.action === "submit-image") {
        await submitImageUrl(response.imageUrl);
        return;
      }

      if (response.action === "select-completed") {
        await applyFilter("Completed Items", "selecting-completed", "Selecting completed eBay listings...");
        return;
      }

      if (response.action === "select-sold") {
        await applyFilter("Sold Items", "selecting-sold", "Selecting sold eBay listings...");
        return;
      }

      if (response.action === "await-results") {
        reportProgress("reading-results", "Reading eBay sold image matches...");
      }
    } catch (error) {
      reportError(response.action, error, {
        pageStage: getPageStage(root.location.href),
        hasCameraButton: Boolean(findCameraButton(root.document)),
        hasImageUrlInput: Boolean(findImageUrlInput(root.document)),
        hasCompletedControl: Boolean(findControlByText(root.document, "Completed Items", "a, button, label")),
        hasSoldControl: Boolean(findControlByText(root.document, "Sold Items", "a, button, label"))
      });
    }
  }

  function announceReady(attempt) {
    chrome.runtime.sendMessage(
      {
        type: "MFS_EBAY_IMAGE_PAGE_READY",
        url: root.location.href,
        pageStage: getPageStage(root.location.href)
      },
      (response) => {
        const runtimeError = chrome.runtime.lastError;

        if ((runtimeError || !response) && attempt < PAGE_READY_RETRIES) {
          root.setTimeout(() => announceReady(attempt + 1), 400);
          return;
        }

        if (runtimeError) {
          debug("No tracked image-search request for this eBay page.", runtimeError.message);
          return;
        }

        if (!response || !response.ok) {
          debug("Image-search request was not accepted.", response && response.error);
          return;
        }

        executeAction(response);
      }
    );
  }

  function init() {
    announceReady(0);
  }

  root.MFSEbayImageSearch = {
    findCameraButton,
    findControlByText,
    findImageUrlInput,
    getPageStage,
    normalizeImageUrl,
    setNativeInputValue
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.MFSEbayImageSearch;
  }

  if (typeof chrome !== "undefined" && chrome.runtime && root.document) {
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
      init();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
