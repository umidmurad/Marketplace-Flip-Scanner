importScripts("ebaySearch.js");

const DEBUG_PREFIX = "[Marketplace Flip Scanner]";
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
      comps: message.comps || []
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
  if (!pendingEbayTabs.has(tabId)) {
    return;
  }

  chrome.tabs.remove(tabId, () => {
    const runtimeError = chrome.runtime.lastError;

    if (runtimeError) {
      console.warn(DEBUG_PREFIX, "Unable to close background eBay search tab.", runtimeError);
      return;
    }

    pendingEbayTabs.delete(tabId);
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

  if (message.type === "MFS_EBAY_RESULTS") {
    forwardEbayResults(message, sender, sendResponse);
    return true;
  }

  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  pendingEbayTabs.delete(tabId);
});

chrome.action.onClicked.addListener(showScannerPanel);
