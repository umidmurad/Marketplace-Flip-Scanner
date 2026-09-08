(function () {
  "use strict";

  const DEBUG_PREFIX = "[Marketplace Flip Scanner]";
  const PANEL_ID = "mfs-stage-one-panel";
  const CHECK_BUTTON_ID = "mfs-check-ebay";
  const COPY_IMAGE_BUTTON_ID = "mfs-copy-image-url";
  const IMAGE_SEARCH_BUTTON_ID = "mfs-check-ebay-image";
  const PROFIT_SETTINGS_KEY = "mfsProfitSettings";
  const PANEL_POSITION_KEY = "mfsPanelPosition";
  const AUTO_OPEN_KEY = "mfsAutoOpenPanel";
  const extractor = window.MFSListingExtractor;
  const compsAnalyzer = window.MFSComps;
  const profitability = window.MFSProfitability;

  const state = {
    lastSignature: "",
    lastListingInfo: null,
    latestAnalysis: null,
    profitSettings: profitability ? profitability.mergeSettings() : {},
    profitOverrides: {},
    panelPosition: null,
    isPanelClosed: false,
    isSearching: false,
    autoOpenPanel: true,
    settingsLoaded: false,
    observer: null,
    refreshTimer: null,
    drag: null,
    resize: null
  };

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

  function extractListingInfo() {
    return extractor.extractListingInfo();
  }

  function formatValue(value, fallback) {
    return value || fallback;
  }

  function formatMoney(value) {
    return Number.isFinite(value) ? `$${value.toFixed(2)}` : "n/a";
  }

  function formatPercent(value) {
    return Number.isFinite(value) ? `${value.toFixed(1)}%` : "n/a";
  }

  function formatRoi(calculation) {
    if (Number.isFinite(calculation.roiPercent)) {
      return formatPercent(calculation.roiPercent);
    }

    if (calculation.purchasePrice === 0 && calculation.expectedProfit > 0) {
      return "Free item";
    }

    return "n/a";
  }

  function createPanel() {
    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.setAttribute("aria-live", "polite");
    panel.innerHTML = [
      "<div class='mfs-header'>",
      "  <strong>Flip Scanner</strong>",
      "  <div class='mfs-header-actions'>",
      "    <span>Version 0.1</span>",
      "    <button class='mfs-close' type='button' aria-label='Close Flip Scanner'>x</button>",
      "  </div>",
      "</div>",
      "<div class='mfs-panel-body'>",
      "  <div class='mfs-listing-card'>",
      "    <div class='mfs-listing-main'>",
      "      <strong data-mfs-field='compactTitle'></strong>",
      "      <span data-mfs-field='compactPrice'></span>",
      "    </div>",
      "    <details class='mfs-listing-details'>",
      "      <summary>Details</summary>",
      "      <dl class='mfs-fields'>",
      "        <div><dt>Title</dt><dd data-mfs-field='title'></dd></div>",
      "        <div><dt>Price</dt><dd data-mfs-field='askingPrice'></dd></div>",
      "        <div><dt>Image</dt><dd data-mfs-field='mainImageUrl'></dd></div>",
      "        <div><dt>URL</dt><dd data-mfs-field='listingUrl'></dd></div>",
      "      </dl>",
      "    </details>",
      "  </div>",
      "  <div class='mfs-search-actions'>",
      "    <button id='mfs-copy-image-url' type='button' title='Copy the captured Marketplace image URL'>Copy Image URL</button>",
      "    <button id='mfs-check-ebay-image' type='button'>Image Search</button>",
      "    <button id='mfs-check-ebay' type='button'>Title Search</button>",
      "  </div>",
      "  <p class='mfs-status' data-mfs-field='status'></p>",
      "  <div class='mfs-results' data-mfs-results hidden></div>",
      "</div>",
      "<div class='mfs-resize-handle' title='Resize panel' aria-hidden='true'></div>"
    ].join("");

    (document.body || document.documentElement).appendChild(panel);
    bindPanelClose(panel);
    bindPanelDrag(panel);
    bindPanelResize(panel);
    loadPanelPosition(panel);
    return panel;
  }

  function copyImageUrl(imageUrl) {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
      return Promise.reject(new Error("Clipboard access is unavailable."));
    }

    return navigator.clipboard.writeText(imageUrl);
  }

  function bindCopyImageButton(panel) {
    const button = panel.querySelector(`#${COPY_IMAGE_BUTTON_ID}`);

    if (!button || button.dataset.mfsBound) {
      return;
    }

    button.dataset.mfsBound = "true";
    button.addEventListener("click", () => {
      const info = extractListingInfo();
      const imageUrl = info && info.mainImageUrl;

      if (!imageUrl) {
        setStatus(panel, "Main image missing. Nothing was copied.", true);
        return;
      }

      copyImageUrl(imageUrl)
        .then(() => {
          console.info(DEBUG_PREFIX, "Copied Marketplace image URL.", { imageUrl });
          setStatus(panel, "Image URL copied. Paste it into eBay image search.", false);
        })
        .catch((error) => {
          warn("Unable to copy Marketplace image URL.", {
            error: error.message,
            imageUrl
          });
          setStatus(panel, "Could not copy the image URL. Check DevTools console.", true);
        });
    });
  }

  function bindImageSearchButton(panel) {
    const button = panel.querySelector(`#${IMAGE_SEARCH_BUTTON_ID}`);

    if (!button || button.dataset.mfsBound) {
      return;
    }

    button.dataset.mfsBound = "true";
    button.addEventListener("click", () => {
      const latestInfo = extractListingInfo();

      if (state.isSearching) {
        setStatus(panel, "An eBay search is already running.", true);
        return;
      }

      if (!latestInfo.mainImageUrl) {
        warn("Cannot search eBay by image because the Marketplace image was not found.", latestInfo);
        setStatus(panel, "Main image missing. Cannot start eBay image search.", true);
        return;
      }

      console.info(DEBUG_PREFIX, "eBay image search clicked. Captured listing payload:", latestInfo);
      state.isSearching = true;
      state.latestAnalysis = null;
      renderResults(panel);
      setStatus(panel, "Opening eBay image search in the background...", false);

      chrome.runtime.sendMessage(
        {
          type: "MFS_OPEN_EBAY_IMAGE_SEARCH",
          listingInfo: latestInfo
        },
        (response) => {
          const runtimeError = chrome.runtime.lastError;

          if (runtimeError || !response || !response.ok) {
            const message = runtimeError ? runtimeError.message : response && response.error;
            state.isSearching = false;
            warn("Failed to start eBay image search.", { message, latestInfo });
            setStatus(panel, `${message || "Could not start eBay image search."} Use Copy Image URL instead.`, true);
            return;
          }

          console.info(DEBUG_PREFIX, "Background eBay image search opened.", response);
          setStatus(panel, "eBay image search is running silently...", false);
        }
      );
    });
  }

  function getPanel() {
    if (state.isPanelClosed) {
      return null;
    }

    return document.getElementById(PANEL_ID) || createPanel();
  }

  function setField(panel, field, value, fallback) {
    const element = panel.querySelector(`[data-mfs-field='${field}']`);
    if (!element) {
      return;
    }

    element.textContent = formatValue(value, fallback);
    element.title = value || "";
    element.classList.toggle("mfs-missing", !value);
  }

  function setStatus(panel, message, isWarning) {
    const status = panel.querySelector("[data-mfs-field='status']");

    if (!status) {
      return;
    }

    status.textContent = message;
    status.classList.toggle("mfs-warning", Boolean(isWarning));
  }

  function renderStat(label, value) {
    const item = document.createElement("div");
    const term = document.createElement("dt");
    const description = document.createElement("dd");

    term.textContent = label;
    description.textContent = value;
    item.append(term, description);
    return item;
  }

  function renderMetric(label, value, className) {
    const item = renderStat(label, value);

    if (className) {
      item.classList.add(className);
    }

    return item;
  }

  function renderEstimateMetric(label, value, key, className) {
    const item = renderMetric(label, value, className);
    const description = item.querySelector("dd");

    if (description) {
      description.dataset.estimateValue = key;
    }

    return item;
  }

  function createBadge(label, tone) {
    const badge = document.createElement("span");

    badge.className = `mfs-badge mfs-badge-${tone || "neutral"}`;
    badge.textContent = label;
    return badge;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function applyPanelPosition(panel, position) {
    if (!position || !Number.isFinite(position.left) || !Number.isFinite(position.top)) {
      return;
    }

    const rect = panel.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - Math.min(rect.height, window.innerHeight - 16) - 8);
    const left = clamp(position.left, 8, maxLeft);
    const top = clamp(position.top, 8, maxTop);

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = "auto";
    panel.style.maxHeight = `calc(100vh - ${Math.round(top) + 8}px)`;

    if (Number.isFinite(position.height) && state.latestAnalysis) {
      applyPanelHeight(panel, position.height);
    }
  }

  function applyPanelHeight(panel, height) {
    const rect = panel.getBoundingClientRect();
    const top = rect.top || 8;
    const minHeight = 260;
    const maxHeight = Math.max(minHeight, window.innerHeight - top - 8);
    const nextHeight = clamp(height, minHeight, maxHeight);

    panel.style.height = `${Math.round(nextHeight)}px`;
    panel.style.maxHeight = `${Math.round(maxHeight)}px`;
  }

  function savePanelPosition(panel) {
    const rect = panel.getBoundingClientRect();
    state.panelPosition = {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      height: Math.round(rect.height)
    };

    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({
        [PANEL_POSITION_KEY]: state.panelPosition
      });
    }
  }

  function loadPanelPosition(panel) {
    if (!chrome.storage || !chrome.storage.local) {
      return;
    }

    chrome.storage.local.get(PANEL_POSITION_KEY, (result) => {
      const runtimeError = chrome.runtime.lastError;

      if (runtimeError) {
        warn("Unable to load panel position.", runtimeError);
        return;
      }

      state.panelPosition = result && result[PANEL_POSITION_KEY];
      applyPanelPosition(panel, state.panelPosition);
    });
  }

  function bindPanelDrag(panel) {
    const handle = panel.querySelector(".mfs-header");

    if (!handle || handle.dataset.mfsDragBound) {
      return;
    }

    handle.dataset.mfsDragBound = "true";
    handle.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) {
        return;
      }

      if (event.button !== 0) {
        return;
      }

      const rect = panel.getBoundingClientRect();
      state.drag = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top
      };
      panel.classList.add("mfs-dragging");
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    handle.addEventListener("pointermove", (event) => {
      if (!state.drag || state.drag.pointerId !== event.pointerId) {
        return;
      }

      applyPanelPosition(panel, {
        left: event.clientX - state.drag.offsetX,
        top: event.clientY - state.drag.offsetY
      });
    });

    handle.addEventListener("pointerup", (event) => {
      if (!state.drag || state.drag.pointerId !== event.pointerId) {
        return;
      }

      state.drag = null;
      panel.classList.remove("mfs-dragging");
      handle.releasePointerCapture(event.pointerId);
      savePanelPosition(panel);
    });

    handle.addEventListener("pointercancel", () => {
      state.drag = null;
      panel.classList.remove("mfs-dragging");
    });
  }

  function bindPanelClose(panel) {
    const closeButton = panel.querySelector(".mfs-close");

    if (!closeButton || closeButton.dataset.mfsCloseBound) {
      return;
    }

    closeButton.dataset.mfsCloseBound = "true";
    closeButton.addEventListener("click", () => {
      state.isPanelClosed = true;
      window.clearTimeout(state.refreshTimer);

      if (state.observer) {
        state.observer.disconnect();
        state.observer = null;
      }

      panel.remove();
    });
  }

  function bindPanelResize(panel) {
    const handle = panel.querySelector(".mfs-resize-handle");

    if (!handle || handle.dataset.mfsResizeBound) {
      return;
    }

    handle.dataset.mfsResizeBound = "true";
    handle.addEventListener("pointerdown", (event) => {
      if (!state.latestAnalysis) {
        return;
      }

      if (event.button !== 0) {
        return;
      }

      const rect = panel.getBoundingClientRect();
      state.resize = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startHeight: rect.height
      };
      panel.classList.add("mfs-resizing");
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    handle.addEventListener("pointermove", (event) => {
      if (!state.resize || state.resize.pointerId !== event.pointerId) {
        return;
      }

      applyPanelHeight(panel, state.resize.startHeight + event.clientY - state.resize.startY);
    });

    handle.addEventListener("pointerup", (event) => {
      if (!state.resize || state.resize.pointerId !== event.pointerId) {
        return;
      }

      state.resize = null;
      panel.classList.remove("mfs-resizing");
      handle.releasePointerCapture(event.pointerId);
      savePanelPosition(panel);
    });

    handle.addEventListener("pointercancel", () => {
      state.resize = null;
      panel.classList.remove("mfs-resizing");
    });
  }

  function normalizeHelpItems(items) {
    const itemList = Array.isArray(items)
      ? items
      : String(items || "").split("\n").filter(Boolean);

    return itemList.map((item) => {
      if (typeof item === "string") {
        const [term, ...rest] = item.split(" - ");

        return {
          term,
          description: rest.join(" - ")
        };
      }

      return item;
    });
  }

  function createInfoControl(label, items) {
    const normalizedItems = normalizeHelpItems(items);
    const info = document.createElement("button");
    const card = document.createElement("span");

    info.className = "mfs-info";
    info.type = "button";
    info.setAttribute("aria-label", `${label} help. ${normalizedItems.map((item) => `${item.term}: ${item.description}`).join(" ")}`);
    info.textContent = "i";

    card.className = "mfs-info-card";
    normalizedItems.forEach((item) => {
      const row = document.createElement("span");
      const term = document.createElement("strong");

      row.className = "mfs-info-row";
      term.textContent = `${item.term} - `;
      row.append(term, document.createTextNode(item.description));
      card.append(row);
    });

    info.append(card);
    return info;
  }

  function createHeadingTitle(label, description) {
    const wrapper = document.createElement("span");
    const title = document.createElement("strong");

    wrapper.className = "mfs-heading-title";
    title.textContent = label;
    wrapper.append(title, createInfoControl(label, description));
    return wrapper;
  }

  function formatInputValue(value, suffix) {
    if (!Number.isFinite(value)) {
      return "";
    }

    const precision = suffix === "%" ? 1 : 2;
    const factor = 10 ** precision;
    const rounded = Math.round((value + Number.EPSILON) * factor) / factor;

    return String(rounded);
  }

  function createNumberInput(name, label, value, suffix) {
    const wrapper = document.createElement("label");
    const labelText = document.createElement("span");
    const input = document.createElement("input");

    labelText.textContent = label;
    input.type = "number";
    input.inputMode = "decimal";
    input.min = "0";
    input.step = suffix === "%" ? "0.1" : "0.01";
    input.value = formatInputValue(value, suffix);
    input.dataset.profitInput = name;
    input.setAttribute("aria-label", label);
    wrapper.append(labelText, input);

    if (suffix) {
      const suffixText = document.createElement("em");
      suffixText.textContent = suffix;
      wrapper.append(suffixText);
    }

    return wrapper;
  }

  function createSelectInput(name, label, value, options) {
    const wrapper = document.createElement("label");
    const labelText = document.createElement("span");
    const select = document.createElement("select");

    labelText.textContent = label;
    select.dataset.profitInput = name;
    select.setAttribute("aria-label", label);

    options.forEach((option) => {
      const element = document.createElement("option");
      element.value = option.value;
      element.textContent = option.label;
      select.append(element);
    });

    select.value = value;
    wrapper.append(labelText, select);
    return wrapper;
  }

  function getDefaultPurchasePrice() {
    return compsAnalyzer.parseMoney(state.lastListingInfo && state.lastListingInfo.askingPrice);
  }

  function getDefaultExpectedSalePrice() {
    return state.latestAnalysis && Number.isFinite(state.latestAnalysis.stats.medianSoldPrice)
      ? state.latestAnalysis.stats.medianSoldPrice
      : null;
  }

  function getAutoBuyerShippingCharged() {
    return state.latestAnalysis && Number.isFinite(state.latestAnalysis.stats.averageShippingPrice)
      ? state.latestAnalysis.stats.averageShippingPrice
      : 0;
  }

  function getActiveFeePercent() {
    const suggested = profitability.suggestFeeProfile(state.lastListingInfo && state.lastListingInfo.title);
    const configuredProfile = profitability.getFeeProfile(state.profitSettings.feeProfile);

    if (configuredProfile.id === "manual") {
      return state.profitSettings.ebayFeePercent;
    }

    if (configuredProfile.id === "auto") {
      return suggested.percent;
    }

    return configuredProfile.percent;
  }

  function getProfitInputs() {
    return {
      purchasePrice: Number.isFinite(state.profitOverrides.purchasePrice)
        ? state.profitOverrides.purchasePrice
        : getDefaultPurchasePrice(),
      expectedSalePrice: Number.isFinite(state.profitOverrides.expectedSalePrice)
        ? state.profitOverrides.expectedSalePrice
        : getDefaultExpectedSalePrice(),
      ...state.profitSettings,
      ebayFeePercent: getActiveFeePercent(),
      buyerShippingCharged: state.profitSettings.buyerShippingChargedMode === "auto"
        ? getAutoBuyerShippingCharged()
        : state.profitSettings.buyerShippingCharged
    };
  }

  function saveProfitSettings() {
    if (!chrome.storage || !chrome.storage.local) {
      return;
    }

    chrome.storage.local.set({
      [PROFIT_SETTINGS_KEY]: state.profitSettings
    });
  }

  function loadProfitSettings(callback) {
    if (!chrome.storage || !chrome.storage.local) {
      state.settingsLoaded = true;
      callback();
      return;
    }

    chrome.storage.local.get(PROFIT_SETTINGS_KEY, (result) => {
      const runtimeError = chrome.runtime.lastError;

      if (runtimeError) {
        warn("Unable to load profit settings.", runtimeError);
      } else {
        state.profitSettings = profitability.mergeSettings(result && result[PROFIT_SETTINGS_KEY]);
      }

      state.settingsLoaded = true;
      callback();
    });
  }

  function updateProfitSummary(root) {
    const inputs = getProfitInputs();
    const calculation = profitability.calculateProfitability(inputs);
    const summary = root.querySelector("[data-profit-summary]");

    if (summary) {
      setText(summary, "[data-profit-value='purchase']", formatMoney(calculation.purchasePrice));
      setText(summary, "[data-profit-value='expectedSale']", formatMoney(calculation.expectedSalePrice));
      setText(summary, "[data-profit-value='expectedNet']", formatMoney(calculation.expectedNetProceeds));
      setText(summary, "[data-profit-value='profit']", formatMoney(calculation.expectedProfit));
      setText(summary, "[data-profit-value='roi']", formatRoi(calculation));
      summary.classList.toggle("mfs-profit-negative", calculation.expectedProfit < 0);
      summary.classList.toggle("mfs-profit-free-purchase", calculation.purchasePrice === 0);
    }

    setText(root, "[data-estimate-value='profit']", formatMoney(calculation.expectedProfit));
    setText(root, "[data-estimate-value='roi']", formatRoi(calculation));
    setText(root, "[data-estimate-value='expectedNet']", formatMoney(calculation.expectedNetProceeds));
    setText(root, "[data-estimate-value='buyerShipping']", formatMoney(calculation.buyerShippingCharged));
    setText(root, "[data-estimate-value='costBreakdown']", getProfitBreakdownText(calculation));

    const detail = summary && summary.querySelector("[data-profit-detail]");
    if (detail) {
      detail.textContent = getProfitBreakdownText(calculation);
    }

    const estimate = root.querySelector("[data-best-estimate]");
    if (estimate) {
      estimate.classList.toggle("mfs-best-estimate-negative", calculation.expectedProfit < 0);
    }

    const hint = root.querySelector("[data-profit-hint]");
    if (hint) {
      const suggested = profitability.suggestFeeProfile(state.lastListingInfo && state.lastListingInfo.title);
      hint.textContent = `Fee: ${state.profitSettings.feeProfile === "auto" ? suggested.label : profitability.getFeeProfile(state.profitSettings.feeProfile).label}`;
    }
  }

  function getProfitBreakdownText(calculation) {
    return [
      `Buyer shipping ${formatMoney(calculation.buyerShippingCharged)}`,
      `Fee base ${formatMoney(calculation.feeBase)}`,
      `Fees ${formatMoney(calculation.ebaySellingFees)}`,
      `Promoted ${formatMoney(calculation.promotedListingFees)}`,
      `Ship cost ${formatMoney(calculation.shippingExpense)}`,
      `Other ${formatMoney(calculation.packagingExpense + calculation.otherExpense)}`
    ].join(" | ");
  }

  function renderBestEstimate(stats, calculation) {
    const strip = document.createElement("div");

    strip.className = "mfs-best-estimate";
    strip.dataset.bestEstimate = "true";
    strip.dataset.mfsSummarySection = "true";
    strip.append(
      renderEstimateMetric("Profit", formatMoney(calculation.expectedProfit), "profit", "mfs-primary-metric"),
      renderEstimateMetric("ROI", formatRoi(calculation), "roi", "mfs-primary-metric"),
      renderEstimateMetric("Expected Net", formatMoney(calculation.expectedNetProceeds), "expectedNet", "mfs-primary-metric"),
      renderEstimateMetric("Cost Breakdown", getProfitBreakdownText(calculation), "costBreakdown", "mfs-detail-metric")
    );

    if (calculation.expectedProfit < 0) {
      strip.classList.add("mfs-best-estimate-negative");
    }

    return strip;
  }

  function createTabNav() {
    const nav = document.createElement("div");
    const tabs = [
      { label: "Summary", target: "[data-mfs-summary-section]" },
      { label: "Assumptions", target: "[data-mfs-assumptions]" },
      { label: "Comparables", target: "[data-mfs-comps-section]" }
    ];

    nav.className = "mfs-tab-nav";
    nav.setAttribute("role", "tablist");
    tabs.forEach((tab, index) => {
      const button = document.createElement("button");

      button.type = "button";
      button.textContent = tab.label;
      button.dataset.mfsScrollTarget = tab.target;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", index === 0 ? "true" : "false");
      nav.append(button);
    });

    return nav;
  }

  function bindTabNav(panel) {
    panel.querySelectorAll("[data-mfs-scroll-target]").forEach((button) => {
      if (button.dataset.mfsBound) {
        return;
      }

      button.dataset.mfsBound = "true";
      button.addEventListener("click", () => {
        const target = panel.querySelector(button.dataset.mfsScrollTarget);

        panel.querySelectorAll("[data-mfs-scroll-target]").forEach((tab) => {
          tab.setAttribute("aria-selected", tab === button ? "true" : "false");
        });

        if (target) {
          if (target.tagName === "DETAILS") {
            target.open = true;
          }

          scrollPanelBodyToTarget(panel, target);
        }
      });
    });
  }

  function scrollPanelBodyToTarget(rootElement, target) {
    const panel = rootElement.closest(`#${PANEL_ID}`);
    const body = panel && panel.querySelector(".mfs-panel-body");

    if (!body) {
      target.scrollIntoView({ block: "start", behavior: "smooth" });
      return;
    }

    const bodyRect = body.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const stickyOffset = 44;
    const top = body.scrollTop + targetRect.top - bodyRect.top - stickyOffset;

    body.scrollTo({
      top: Math.max(0, top),
      behavior: "smooth"
    });
  }

  function setText(root, selector, value) {
    const element = root.querySelector(selector);

    if (element) {
      element.textContent = value;
    }
  }

  function bindProfitInputs(panel) {
    panel.querySelectorAll("[data-profit-input]").forEach((input) => {
      if (input.dataset.mfsBound) {
        return;
      }

      input.dataset.mfsBound = "true";
      input.addEventListener(input.tagName === "SELECT" ? "change" : "input", () => {
        const value = input.tagName === "SELECT" ? input.value : profitability.toNumber(input.value);

        if (input.dataset.profitInput === "purchasePrice" || input.dataset.profitInput === "expectedSalePrice") {
          state.profitOverrides[input.dataset.profitInput] = value;
        } else if (input.dataset.profitInput === "feeProfile") {
          state.profitSettings.feeProfile = value;
          const activeFeePercent = getActiveFeePercent();

          if (Number.isFinite(activeFeePercent)) {
            state.profitSettings.ebayFeePercent = activeFeePercent;
            const feeInput = panel.querySelector("[data-profit-input='ebayFeePercent']");

            if (feeInput) {
              feeInput.value = formatInputValue(activeFeePercent, "%");
            }
          }

          saveProfitSettings();
        } else if (input.dataset.profitInput === "buyerShippingChargedMode") {
          state.profitSettings.buyerShippingChargedMode = value;
          const shippingInput = panel.querySelector("[data-profit-input='buyerShippingCharged']");

          if (shippingInput && value === "auto") {
            shippingInput.value = formatInputValue(getAutoBuyerShippingCharged(), "$");
          }

          saveProfitSettings();
        } else {
          state.profitSettings[input.dataset.profitInput] = value;
          if (input.dataset.profitInput === "ebayFeePercent") {
            state.profitSettings.feeProfile = "manual";
            const feeProfileInput = panel.querySelector("[data-profit-input='feeProfile']");

            if (feeProfileInput) {
              feeProfileInput.value = "manual";
            }
          }

          if (input.dataset.profitInput === "buyerShippingCharged") {
            state.profitSettings.buyerShippingChargedMode = "manual";
            const shippingModeInput = panel.querySelector("[data-profit-input='buyerShippingChargedMode']");

            if (shippingModeInput) {
              shippingModeInput.value = "manual";
            }
          }

          saveProfitSettings();
        }

        updateProfitSummary(panel);
      });
    });
  }

  function createProfitabilitySection() {
    const section = document.createElement("div");
    const inputs = getProfitInputs();

    section.className = "mfs-profit";
    section.innerHTML = [
      "<div class='mfs-results-heading'>",
      "  <span class='mfs-settings-saved'>Settings saved</span>",
      "</div>",
      "<p class='mfs-profit-hint' data-profit-hint></p>",
      "<details class='mfs-assumptions' data-mfs-assumptions>",
      "  <summary>Edit assumptions</summary>",
      "  <p class='mfs-assumption-note'>Buyer-paid shipping increases revenue and the eBay fee base. Your shipping cost is the label/postage you pay.</p>",
      "  <div class='mfs-profit-grid' data-profit-controls></div>",
      "</details>"
    ].join("");

    const heading = section.querySelector(".mfs-results-heading");
    heading.prepend(createHeadingTitle(
      "Profitability",
      [
        "Purchase - Marketplace asking price or your edited buy cost.",
        "Expected Sale - Median used comparable price or your edited sale estimate.",
        "Expected Net - Sale price after fees, shipping, packaging, and other expenses.",
        "Buyer Shipping - Shipping amount the buyer pays; it increases revenue and the eBay fee base.",
        "Profit - Expected net minus purchase price.",
        "ROI - Profit divided by purchase price.",
        "Shipping Cost - Your actual label/postage cost; it reduces profit."
      ].join("\n")
    ));

    const controls = section.querySelector("[data-profit-controls]");
    controls.append(
      createNumberInput("purchasePrice", "Purchase", inputs.purchasePrice, "$"),
      createNumberInput("expectedSalePrice", "Expected Sale", inputs.expectedSalePrice, "$"),
      createSelectInput(
        "feeProfile",
        "Fee Category",
        state.profitSettings.feeProfile,
        profitability.FEE_PROFILES.map((profile) => ({
          value: profile.id,
          label: Number.isFinite(profile.percent) ? `${profile.label} (${profile.percent}%)` : profile.label
        }))
      ),
      createNumberInput("ebayFeePercent", "eBay Fee", inputs.ebayFeePercent, "%"),
      createNumberInput("salesTaxPercent", "Sales Tax Est.", inputs.salesTaxPercent, "%"),
      createNumberInput("promotedListingPercent", "Promoted", inputs.promotedListingPercent, "%"),
      createSelectInput(
        "buyerShippingChargedMode",
        "Buyer Shipping Mode",
        state.profitSettings.buyerShippingChargedMode,
        [
          { value: "auto", label: "Auto from comparables" },
          { value: "manual", label: "Manual" }
        ]
      ),
      createNumberInput("buyerShippingCharged", "Buyer Shipping", inputs.buyerShippingCharged, "$"),
      createNumberInput("shippingExpense", "Shipping Cost", inputs.shippingExpense, "$"),
      createNumberInput("packagingExpense", "Packaging", inputs.packagingExpense, "$"),
      createNumberInput("otherExpense", "Other", inputs.otherExpense, "$")
    );

    updateProfitSummary(section);
    return section;
  }

  function getCompBadges(comp) {
    const badges = [];
    const score = comp.similarityScore || 0;
    const title = String(comp.title || "").toLowerCase();

    if (comp.isUsedForStats) {
      badges.push(createBadge(score >= 0.8 ? "Strong match" : "Used", score >= 0.8 ? "good" : "neutral"));
    } else {
      badges.push(createBadge("Excluded", "bad"));
    }

    if (score < 0.65) {
      badges.push(createBadge("Weak match", "warn"));
    }

    if (/\b(lot|bundle|pair|set of|pack of|\d+\s*(pc|pcs|piece|pieces))\b/i.test(title)) {
      badges.push(createBadge("Lot", "warn"));
    }

    if (comp.isOutlier) {
      badges.push(createBadge("Outlier", "bad"));
    }

    if (!Number.isFinite(comp.shippingPriceValue)) {
      badges.push(createBadge("Shipping unknown", "neutral"));
    }

    return badges;
  }

  function renderResults(panel) {
    const container = panel.querySelector("[data-mfs-results]");

    if (!container) {
      return;
    }

    if (!state.latestAnalysis) {
      container.textContent = "";
      container.hidden = true;
      return;
    }

    try {
      const fragment = document.createDocumentFragment();
      const { stats, comps, searchUrl, resultsUrl } = state.latestAnalysis;
      const calculation = profitability.calculateProfitability(getProfitInputs());

      const heading = document.createElement("div");
      heading.className = "mfs-results-heading";

      const link = document.createElement("a");
      link.href = resultsUrl || searchUrl;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "Open search";

      heading.append(
        createHeadingTitle(
          "eBay Sold Comparables",
          [
            "Used - Accepted comparables used for stats, out of all parsed sold candidates.",
            "Median - Middle sold price from used comparables; less sensitive to outliers.",
            "Average - Mean sold price from used comparables.",
            "Low - Lowest sold price among used comparables.",
            "High - Highest sold price among used comparables.",
            "Excluded - Parsed results shown but not used because of weak title match or outlier pricing."
          ].join("\n")
        ),
        link
      );

      const statsList = document.createElement("dl");
      statsList.className = "mfs-stats";
      statsList.append(
        renderMetric("Used", `${stats.compCount} of ${stats.candidateCount}`, "mfs-primary-metric"),
        renderMetric("Median", compsAnalyzer.formatMoney(stats.medianSoldPrice) || "n/a", "mfs-primary-metric"),
        renderMetric("Average", compsAnalyzer.formatMoney(stats.averageSoldPrice) || "n/a", "mfs-secondary-metric"),
        renderMetric("Low", compsAnalyzer.formatMoney(stats.lowestSoldPrice) || "n/a", "mfs-secondary-metric"),
        renderMetric("High", compsAnalyzer.formatMoney(stats.highestSoldPrice) || "n/a", "mfs-secondary-metric")
      );

      const note = document.createElement("p");
      note.className = "mfs-results-note";
      note.textContent = stats.candidateCount === 0
        ? "No eBay result rows were parsed. Check the eBay tab console for extractor diagnostics."
        : stats.outlierCount
        ? `${stats.outlierCount} price outlier excluded from stats.`
        : "Stats use title-matched sold results only.";

      const list = document.createElement("ol");
      list.className = "mfs-comp-list";
      list.dataset.mfsCompList = "true";

      comps.forEach((comp) => {
        const item = document.createElement("li");
        item.className = comp.isUsedForStats ? "mfs-comp mfs-comp-used" : "mfs-comp mfs-comp-excluded";

        const row = document.createElement("div");
        row.className = "mfs-comp-topline";

        const price = document.createElement("strong");
        price.textContent = comp.soldPrice || "No price";

        const badgeGroup = document.createElement("span");
        badgeGroup.className = "mfs-badge-group";
        badgeGroup.append(...getCompBadges(comp));

        row.append(price, badgeGroup);

        const compTitle = document.createElement("a");
        compTitle.href = comp.listingUrl;
        compTitle.target = "_blank";
        compTitle.rel = "noreferrer";
        compTitle.textContent = comp.title || "Untitled eBay result";

        const meta = document.createElement("p");
        meta.textContent = [
          comp.saleDate || "Date n/a",
          comp.condition || "Condition n/a",
          `match ${Math.round((comp.similarityScore || 0) * 100)}%`,
          comp.shippingPrice || "Shipping unknown"
        ].join(" | ");

        const reason = document.createElement("p");
        reason.className = "mfs-comp-reason";
        reason.textContent = comp.exclusionReasons && comp.exclusionReasons.length
          ? comp.exclusionReasons.join(", ")
          : `Matched: ${(comp.matchedTokens || []).join(", ") || "title terms"}`;

        item.append(row, compTitle, meta, reason);
        list.append(item);
      });

      const compsSection = document.createElement("section");
      compsSection.className = "mfs-comps-section";
      compsSection.dataset.mfsCompsSection = "true";
      compsSection.append(heading, statsList, note, list);

      fragment.append(
        createTabNav(),
        renderBestEstimate(stats, calculation),
        createProfitabilitySection(),
        compsSection
      );
      container.replaceChildren(fragment);
      container.hidden = false;
      bindProfitInputs(container);
      bindTabNav(container);
      updateProfitSummary(container);
    } catch (error) {
      warn("Unable to render eBay results panel.", {
        error: error.message,
        stack: error.stack,
        analysis: state.latestAnalysis
      });
      container.hidden = false;
      container.replaceChildren(createRenderError(error));
    }
  }

  function createRenderError(error) {
    const message = document.createElement("p");

    message.className = "mfs-render-error";
    message.textContent = `Could not render eBay results. Check DevTools console. ${error.message || ""}`;
    return message;
  }

  function renderPanel(info) {
    const panel = getPanel();
    if (!panel) {
      return;
    }

    resetListingStateIfNeeded(info);
    state.lastListingInfo = info;

    setField(panel, "compactTitle", info.title, "Listing title not found");
    setField(panel, "compactPrice", info.askingPrice, "Price not found");
    setField(panel, "title", info.title, "Not found");
    setField(panel, "askingPrice", info.askingPrice, "Not found");
    setField(panel, "mainImageUrl", info.mainImageUrl, "Not found");
    setField(panel, "listingUrl", info.listingUrl, "Not found");

    const missingFields = Object.entries(info)
      .filter(([, value]) => !value)
      .map(([key]) => key);

    if (state.isSearching) {
      setStatus(panel, "Waiting for eBay sold listings...", false);
    } else if (state.latestAnalysis) {
      const method = state.latestAnalysis.searchMethod === "image" ? " from image search" : "";
      setStatus(panel, `Loaded ${state.latestAnalysis.stats.candidateCount} eBay sold candidates${method}.`, false);
    } else if (missingFields.length === 0) {
      setStatus(panel, "Listing captured. Ready to check eBay comparables.");
    } else {
      setStatus(panel, `Missing: ${missingFields.join(", ")}. Check DevTools console for details.`, true);
    }

    renderResults(panel);
    updateResizeAvailability(panel);
    bindCopyImageButton(panel);
    bindImageSearchButton(panel);

    const copyButton = panel.querySelector(`#${COPY_IMAGE_BUTTON_ID}`);
    if (copyButton) {
      copyButton.disabled = !info.mainImageUrl;
    }

    const imageButton = panel.querySelector(`#${IMAGE_SEARCH_BUTTON_ID}`);
    if (imageButton) {
      imageButton.disabled = !info.mainImageUrl;
    }

    const button = panel.querySelector(`#${CHECK_BUTTON_ID}`);
    if (button && !button.dataset.mfsBound) {
      button.dataset.mfsBound = "true";
      button.addEventListener("click", () => {
        const latestInfo = extractListingInfo();
        const currentStatus = panel.querySelector("[data-mfs-field='status']");

        if (state.isSearching) {
          setStatus(panel, "An eBay search is already running.", true);
          return;
        }

        console.info(DEBUG_PREFIX, "Check eBay clicked. Captured listing payload:", latestInfo);

        if (!latestInfo.title) {
          warn("Cannot search eBay because the listing title was not found.", latestInfo);
          if (currentStatus) {
            currentStatus.textContent = "Title missing. Cannot open a useful eBay search.";
            currentStatus.classList.add("mfs-warning");
          }
          return;
        }

        if (currentStatus) {
          currentStatus.textContent = "Opening eBay sold listings in the background...";
          currentStatus.classList.remove("mfs-warning");
        }

        state.isSearching = true;
        state.latestAnalysis = null;
        renderResults(panel);

        chrome.runtime.sendMessage(
          {
            type: "MFS_OPEN_EBAY_SEARCH",
            listingInfo: latestInfo
          },
          (response) => {
            const runtimeError = chrome.runtime.lastError;

            if (runtimeError || !response || !response.ok) {
              const message = runtimeError ? runtimeError.message : response && response.error;
              state.isSearching = false;
              warn("Failed to open eBay search.", { message, latestInfo });
              if (currentStatus) {
                currentStatus.textContent = "Could not open eBay. Check DevTools console.";
                currentStatus.classList.add("mfs-warning");
              }
              return;
            }

            console.info(DEBUG_PREFIX, "eBay sold listings search opened.", response);
            if (currentStatus) {
              currentStatus.textContent = "Opened eBay in the background. Waiting for sold listings...";
              currentStatus.classList.remove("mfs-warning");
            }
          }
        );
      });
    }
  }

  function refresh() {
    if (state.isPanelClosed && !state.autoOpenPanel) {
      return;
    }

    const info = extractListingInfo();
    const signature = JSON.stringify(info);

    if (signature !== state.lastSignature) {
      state.lastSignature = signature;
      renderPanel(info);
    }
  }

  function resetListingStateIfNeeded(info) {
    if (!state.lastListingInfo) {
      return;
    }

    const previousKey = `${state.lastListingInfo.listingUrl}|${state.lastListingInfo.title}|${state.lastListingInfo.askingPrice}`;
    const nextKey = `${info.listingUrl}|${info.title}|${info.askingPrice}`;

    if (previousKey === nextKey) {
      return;
    }

    state.latestAnalysis = null;
    state.isSearching = false;
    state.profitOverrides = {};
  }

  function updateResizeAvailability(panel) {
    panel.classList.toggle("mfs-can-resize", Boolean(state.latestAnalysis));

    if (!state.latestAnalysis) {
      panel.style.height = "";
      panel.style.maxHeight = "";
      return;
    }

    if (state.panelPosition && Number.isFinite(state.panelPosition.height)) {
      applyPanelHeight(panel, state.panelPosition.height);
    }
  }

  function handleEbayResults(message, sendResponse) {
    const panel = getPanel();
    if (!panel) {
      sendResponse({ ok: false, error: "Panel is closed." });
      return;
    }

    const listingInfo = message.listingInfo || state.lastListingInfo || extractListingInfo();
    const analysis = compsAnalyzer.analyzeComps(listingInfo, message.comps || []);

    state.isSearching = false;
    state.latestAnalysis = {
      ...analysis,
      searchUrl: message.searchUrl,
      resultsUrl: message.resultsUrl,
      searchMethod: message.searchMethod || "title"
    };

    console.info(DEBUG_PREFIX, "Received eBay sold comparables.", state.latestAnalysis);
    renderPanel(listingInfo);
    sendResponse({ ok: true });
  }

  function scheduleRefresh() {
    window.clearTimeout(state.refreshTimer);
    state.refreshTimer = window.setTimeout(refresh, 250);
  }

  function startObserver() {
    if (state.observer) {
      return;
    }

    state.observer = new MutationObserver(scheduleRefresh);
    state.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "content", "aria-label"]
    });
    debug("DOM observer started.");
  }

  function showPanel() {
    state.isPanelClosed = false;
    const panel = getPanel();

    if (!panel) {
      return;
    }

    renderPanel(extractListingInfo());
    startObserver();
  }

  function init() {
    if (!extractor || !compsAnalyzer || !profitability) {
      warn("Required modules did not load; panel cannot initialize.", {
        hasExtractor: Boolean(extractor),
        hasCompsAnalyzer: Boolean(compsAnalyzer),
        hasProfitability: Boolean(profitability)
      });
      return;
    }

    if (!/\/marketplace\/item\//.test(window.location.pathname)) {
      debug("Not an individual Marketplace listing page; content script exiting.", window.location.href);
      return;
    }

    debug("Initializing content script.");
    loadProfitSettings(() => {
      loadAutoOpenSetting((autoOpen) => {
        state.autoOpenPanel = autoOpen;
        state.isPanelClosed = !autoOpen;

        if (autoOpen) {
          refresh();
        }
      });
      startObserver();
      window.addEventListener("resize", () => {
        const panel = document.getElementById(PANEL_ID);

        if (panel) {
          applyPanelPosition(panel, state.panelPosition || {
            left: panel.getBoundingClientRect().left,
            top: panel.getBoundingClientRect().top,
            height: panel.getBoundingClientRect().height
          });
        }
      });
      window.setTimeout(refresh, 1000);
      window.setTimeout(refresh, 3000);
    });
  }

  function loadAutoOpenSetting(callback) {
    if (!chrome.storage || !chrome.storage.local) {
      callback(true);
      return;
    }

    chrome.storage.local.get(AUTO_OPEN_KEY, (result) => {
      const runtimeError = chrome.runtime.lastError;

      if (runtimeError) {
        warn("Unable to load auto-open setting.", runtimeError);
        callback(true);
        return;
      }

      callback(result && result[AUTO_OPEN_KEY] !== false);
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) {
      return false;
    }

    if (message.type === "MFS_EBAY_RESULTS") {
      handleEbayResults(message, sendResponse);
      return false;
    }

    if (message.type === "MFS_EBAY_SEARCH_STATUS") {
      const panel = getPanel();

      if (message.isError) {
        state.isSearching = false;
      }

      if (panel) {
        setStatus(panel, message.message || "eBay search status unavailable.", Boolean(message.isError));
      }

      console[message.isError ? "warn" : "info"](DEBUG_PREFIX, "eBay search status.", {
        message: message.message,
        diagnostics: message.diagnostics
      });
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "MFS_SHOW_PANEL") {
      showPanel();
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
