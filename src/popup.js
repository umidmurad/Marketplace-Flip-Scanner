(function () {
  "use strict";

  const AUTO_OPEN_KEY = "mfsAutoOpenPanel";
  const showButton = document.getElementById("mfs-show-panel");
  const autoOpenInput = document.getElementById("mfs-auto-open");
  const status = document.getElementById("mfs-popup-status");

  function setStatus(message, isWarning) {
    status.textContent = message;
    status.classList.toggle("mfs-warning", Boolean(isWarning));
  }

  function getActiveTab(callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      callback(tabs && tabs[0]);
    });
  }

  function isMarketplaceListing(tab) {
    return Boolean(tab && /https:\/\/(?:www|web)\.facebook\.com\/marketplace\/item\//.test(tab.url || ""));
  }

  chrome.storage.local.get(AUTO_OPEN_KEY, (result) => {
    autoOpenInput.checked = result && result[AUTO_OPEN_KEY] !== false;
  });

  autoOpenInput.addEventListener("change", () => {
    chrome.storage.local.set({ [AUTO_OPEN_KEY]: autoOpenInput.checked }, () => {
      setStatus(autoOpenInput.checked ? "Auto-open enabled." : "Auto-open disabled.");
    });
  });

  showButton.addEventListener("click", () => {
    getActiveTab((tab) => {
      if (!isMarketplaceListing(tab)) {
        setStatus("Open a Facebook Marketplace listing first.", true);
        return;
      }

      chrome.tabs.sendMessage(tab.id, { type: "MFS_SHOW_PANEL" }, () => {
        const runtimeError = chrome.runtime.lastError;

        if (runtimeError) {
          setStatus("Refresh the listing page, then try again.", true);
          return;
        }

        setStatus("Panel shown.");
      });
    });
  });
})();
