importScripts("ebaySearch.js");

const DEBUG_PREFIX = "[Marketplace Flip Scanner]";
const EBAY_HOME_URL = "https://www.ebay.com/";
const IMAGE_SEARCH_TIMEOUT_MS = 60000;
const pendingEbayTabs = new Map();

function debug(message, data) {
  if (data === undefined) {
    console.debug(DEBUG_PREFIX, message);
    return;
  }

  console.debug(DEBUG_PREFIX, message, data);
}

function openEbaySearch(listingInfo, sourceTabId, sendResponse) {
  let url;

  try {
    url = self.MFSEbaySearch.buildSoldListingsSearchUrl(listingInfo);
  } catch (error) {
    console.warn(DEBUG_PREFIX, "Unable to build eBay search URL.", {
      error: error.message,
      listingInfo
    });
    sendResponse({ ok: false, error: error.message });
    return;
  }

  chrome.tabs.create({ active: false, url }, (tab) => {
    const runtimeError = chrome.runtime.lastError;

    if (runtimeError) {
      console.warn(DEBUG_PREFIX, "Unable to open eBay search tab.", runtimeError);
      sendResponse({ ok: false, error: runtimeError.message });
      return;
    }

    if (tab && tab.id && sourceTabId) {
      pendingEbayTabs.set(tab.id, {
        mode: "title",
        sourceTabId,
        listingInfo,
        searchUrl: url
      });
    }

    debug("Opened background eBay sold listings search.", {
      tabId: tab && tab.id,
      url,
      listingInfo
    });
    sendResponse({ ok: true, url, tabId: tab && tab.id });
  });
}

function sendMarketplaceMessage(pending, message, callback) {
  if (!pending || !pending.sourceTabId) {
    if (callback) {
      callback();
    }
    return;
  }

  chrome.tabs.sendMessage(pending.sourceTabId, message, () => {
    const runtimeError = chrome.runtime.lastError;

    if (runtimeError) {
      console.warn(DEBUG_PREFIX, "Unable to update Marketplace image-search status.", runtimeError);
    }

    if (callback) {
      callback();
    }
  });
}

function getImageSearchAction(urlValue, pending) {
  let url;

  try {
    url = new URL(urlValue);
  } catch (error) {
    return { ok: false, error: "eBay opened an invalid URL." };
  }

  if (/\/splashui\/challenge/i.test(url.pathname)) {
    return {
      ok: false,
      error: "eBay interrupted the background image search with a verification page."
    };
  }

  if (url.pathname === "/sch/i.html" && url.searchParams.has("visualSearchGuid")) {
    if (url.searchParams.get("LH_Complete") !== "1") {
      return { ok: true, action: "select-completed" };
    }

    if (url.searchParams.get("LH_Sold") !== "1") {
      return { ok: true, action: "select-sold" };
    }

    pending.searchUrl = url.href;
    return { ok: true, action: "await-results" };
  }

  return {
    ok: true,
    action: "submit-image",
    imageUrl: pending.imageUrl
  };
}

function failImageSearch(tabId, error, diagnostics) {
  const pending = pendingEbayTabs.get(tabId);

  if (!pending || pending.mode !== "image" || pending.isFailing) {
    return;
  }

  pending.isFailing = true;

  if (pending.timeoutId) {
    clearTimeout(pending.timeoutId);
    pending.timeoutId = null;
  }

  console.warn(DEBUG_PREFIX, "eBay image search failed.", {
    tabId,
    error,
    diagnostics
  });

  sendMarketplaceMessage(
    pending,
    {
      type: "MFS_EBAY_IMAGE_STATUS",
      message: `${error} Use Copy Image URL or title search instead.`,
      isError: true,
      diagnostics: diagnostics || {}
    },
    () => closeTrackedEbayTab(tabId)
  );
}

function openEbayImageSearch(listingInfo, sourceTabId, sendResponse) {
  let imageUrl = String((listingInfo && listingInfo.mainImageUrl) || "").trim();
  let parsedImageUrl;

  if (!imageUrl) {
    sendResponse({ ok: false, error: "Cannot search eBay by image without a Marketplace image URL." });
    return;
  }

  try {
    parsedImageUrl = new URL(imageUrl);
  } catch (error) {
    sendResponse({ ok: false, error: "The captured Marketplace image URL is invalid." });
    return;
  }

  if (parsedImageUrl.protocol !== "https:" && parsedImageUrl.protocol !== "http:") {
    sendResponse({ ok: false, error: "The captured image must use an HTTP or HTTPS URL." });
    return;
  }

  imageUrl = parsedImageUrl.href;

  chrome.tabs.create({ active: false, url: EBAY_HOME_URL }, (tab) => {
    const runtimeError = chrome.runtime.lastError;

    if (runtimeError || !tab || !tab.id) {
      const error = runtimeError ? runtimeError.message : "eBay tab was not created.";
      console.warn(DEBUG_PREFIX, "Unable to open eBay image-search tab.", error);
      sendResponse({ ok: false, error });
      return;
    }

    const pending = {
      mode: "image",
      sourceTabId,
      listingInfo,
      imageUrl,
      searchUrl: "",
      timeoutId: null,
      isFailing: false
    };

    pending.timeoutId = setTimeout(() => {
      failImageSearch(tab.id, "eBay image search did not finish in time.", {
        stage: "timeout"
      });
    }, IMAGE_SEARCH_TIMEOUT_MS);

    pendingEbayTabs.set(tab.id, pending);
    debug("Opened background eBay image search.", {
      tabId: tab.id,
      sourceTabId,
      imageUrl
    });
    sendResponse({ ok: true, tabId: tab.id, mode: "image" });
  });
}

function handleImagePageReady(message, sender, sendResponse) {
  const tabId = sender && sender.tab && sender.tab.id;
  const pending = pendingEbayTabs.get(tabId);

  if (!pending || pending.mode !== "image") {
    sendResponse({ ok: false, action: "ignore", error: "No tracked image search for this eBay tab." });
    return;
  }

  const action = getImageSearchAction(message.url, pending);

  if (!action.ok) {
    sendResponse(action);
    failImageSearch(tabId, action.error, {
      stage: message.pageStage,
      url: message.url
    });
    return;
  }

  debug("Continuing eBay image-search automation.", {
    tabId,
    pageStage: message.pageStage,
    action: action.action,
    url: message.url
  });
  sendResponse(action);
}

function forwardImageProgress(message, sender) {
  const tabId = sender && sender.tab && sender.tab.id;
  const pending = pendingEbayTabs.get(tabId);

  if (!pending || pending.mode !== "image") {
    return;
  }

  sendMarketplaceMessage(pending, {
    type: "MFS_EBAY_IMAGE_STATUS",
    message: message.message,
    isError: false,
    diagnostics: {
      stage: message.stage,
      url: message.url
    }
  });
}

function forwardEbayResults(message, sender, sendResponse) {
  const ebayTabId = sender && sender.tab && sender.tab.id;
  const pending = pendingEbayTabs.get(ebayTabId);

  if (!pending) {
    debug("Received eBay results with no tracked Marketplace tab.", {
      ebayTabId,
      url: message.url,
      compCount: message.comps && message.comps.length
    });
    sendResponse({ ok: false, error: "No tracked Marketplace tab for this eBay search." });
    return;
  }

  chrome.tabs.sendMessage(
    pending.sourceTabId,
    {
      type: "MFS_EBAY_RESULTS",
      listingInfo: pending.listingInfo,
      searchUrl: pending.searchUrl,
      resultsUrl: message.url,
      comps: message.comps || [],
      searchMethod: pending.mode || "title"
    },
    (response) => {
      const runtimeError = chrome.runtime.lastError;

      if (runtimeError) {
        console.warn(DEBUG_PREFIX, "Unable to forward eBay results to Marketplace tab.", runtimeError);
        if (message.isFinal) {
          closeTrackedEbayTab(ebayTabId);
        }
        sendResponse({ ok: false, error: runtimeError.message });
        return;
      }

      debug("Forwarded eBay results to Marketplace tab.", {
        sourceTabId: pending.sourceTabId,
        ebayTabId,
        compCount: message.comps && message.comps.length,
        isFinal: Boolean(message.isFinal)
      });

      if (message.isFinal) {
        closeTrackedEbayTab(ebayTabId);
      }

      sendResponse({ ok: true, response });
    }
  );
}

function closeTrackedEbayTab(tabId) {
  const pending = pendingEbayTabs.get(tabId);

  if (!pending) {
    return;
  }

  if (pending.timeoutId) {
    clearTimeout(pending.timeoutId);
  }

  pendingEbayTabs.delete(tabId);

  chrome.tabs.remove(tabId, () => {
    const runtimeError = chrome.runtime.lastError;

    if (runtimeError) {
      console.warn(DEBUG_PREFIX, "Unable to close background eBay search tab.", runtimeError);
      return;
    }

    debug("Closed background eBay search tab.", { tabId });
  });
}

function showScannerPanel(tab) {
  if (!tab || !tab.id || !/https:\/\/(?:www|web)\.facebook\.com\/marketplace\/item\//.test(tab.url || "")) {
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: "MFS_SHOW_PANEL" }, () => {
    const runtimeError = chrome.runtime.lastError;

    if (runtimeError) {
      console.warn(DEBUG_PREFIX, "Unable to show scanner panel.", runtimeError);
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) {
    return false;
  }

  if (message.type === "MFS_OPEN_EBAY_SEARCH") {
    debug("Received eBay search request.", {
      senderTabId: sender && sender.tab && sender.tab.id,
      listingInfo: message.listingInfo
    });
    openEbaySearch(message.listingInfo, sender && sender.tab && sender.tab.id, sendResponse);
    return true;
  }

  if (message.type === "MFS_OPEN_EBAY_IMAGE_SEARCH") {
    debug("Received eBay image-search request.", {
      senderTabId: sender && sender.tab && sender.tab.id,
      listingInfo: message.listingInfo
    });
    openEbayImageSearch(message.listingInfo, sender && sender.tab && sender.tab.id, sendResponse);
    return true;
  }

  if (message.type === "MFS_EBAY_IMAGE_PAGE_READY") {
    handleImagePageReady(message, sender, sendResponse);
    return false;
  }

  if (message.type === "MFS_EBAY_IMAGE_PROGRESS") {
    forwardImageProgress(message, sender);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "MFS_EBAY_IMAGE_ERROR") {
    const tabId = sender && sender.tab && sender.tab.id;
    failImageSearch(tabId, message.message || "eBay image-search automation failed.", {
      stage: message.stage,
      url: message.url,
      page: message.diagnostics || {}
    });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "MFS_EBAY_RESULTS") {
    forwardEbayResults(message, sender, sendResponse);
    return true;
  }

  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const pending = pendingEbayTabs.get(tabId);

  if (!pending) {
    return;
  }

  if (pending.timeoutId) {
    clearTimeout(pending.timeoutId);
  }

  pendingEbayTabs.delete(tabId);

  if (pending.mode === "image") {
    sendMarketplaceMessage(pending, {
      type: "MFS_EBAY_IMAGE_STATUS",
      message: "The background eBay image-search tab closed before results were ready.",
      isError: true,
      diagnostics: { stage: "tab-closed" }
    });
  }
});

chrome.action.onClicked.addListener(showScannerPanel);
