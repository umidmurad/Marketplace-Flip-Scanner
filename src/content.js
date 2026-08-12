(function () {
  "use strict";

  const DEBUG_PREFIX = "[Marketplace Flip Scanner]";
  const PANEL_ID = "mfs-stage-one-panel";
  const CHECK_BUTTON_ID = "mfs-check-ebay";
  const PROFIT_SETTINGS_KEY = "mfsProfitSettings";
  const PANEL_POSITION_KEY = "mfsPanelPosition";
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

  function createPanel() {
    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.setAttribute("aria-live", "polite");
    panel.innerHTML = [
      "<div class='mfs-header'>",
      "  <strong>Flip Scanner</strong>",
      "  <div class='mfs-header-actions'>",
      "    <span>Stage 4</span>",
      "    <button class='mfs-close' type='button' aria-label='Close Flip Scanner'>x</button>",
      "  </div>",
      "</div>",
      "<div class='mfs-panel-body'>",
      "  <dl class='mfs-fields'>",
      "    <div><dt>Title</dt><dd data-mfs-field='title'></dd></div>",
      "    <div><dt>Price</dt><dd data-mfs-field='askingPrice'></dd></div>",
      "    <div><dt>Image</dt><dd data-mfs-field='mainImageUrl'></dd></div>",
      "    <div><dt>URL</dt><dd data-mfs-field='listingUrl'></dd></div>",
      "  </dl>",
      "  <button id='mfs-check-ebay' type='button'>Check eBay</button>",
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
    const summary = root.querySelector("[data-profit-summary]");

    if (!summary) {
      return;
    }

    const inputs = getProfitInputs();
    const calculation = profitability.calculateProfitability(inputs);

    setText(summary, "[data-profit-value='purchase']", formatMoney(calculation.purchasePrice));
    setText(summary, "[data-profit-value='expectedSale']", formatMoney(calculation.expectedSalePrice));
    setText(summary, "[data-profit-value='expectedNet']", formatMoney(calculation.expectedNetProceeds));
    setText(summary, "[data-profit-value='profit']", formatMoney(calculation.expectedProfit));
    setText(summary, "[data-profit-value='roi']", formatPercent(calculation.roiPercent));

    const detail = summary.querySelector("[data-profit-detail]");
    if (detail) {
      detail.textContent = [
        `Buyer shipping ${formatMoney(calculation.buyerShippingCharged)}`,
        `Fee base ${formatMoney(calculation.feeBase)}`,
        `Fees ${formatMoney(calculation.ebaySellingFees)}`,
        `Promoted ${formatMoney(calculation.promotedListingFees)}`,
        `Ship cost ${formatMoney(calculation.shippingExpense)}`,
        `Other ${formatMoney(calculation.packagingExpense + calculation.otherExpense)}`
      ].join(" | ");
    }

    summary.classList.toggle("mfs-profit-negative", calculation.expectedProfit < 0);

    const hint = root.querySelector("[data-profit-hint]");
    if (hint) {
      const suggested = profitability.suggestFeeProfile(state.lastListingInfo && state.lastListingInfo.title);
      const shippingCount = state.latestAnalysis ? state.latestAnalysis.stats.shippingCompCount : 0;
      hint.textContent = [
        `Fee: ${state.profitSettings.feeProfile === "auto" ? suggested.label : profitability.getFeeProfile(state.profitSettings.feeProfile).label}`,
        state.profitSettings.buyerShippingChargedMode === "auto"
          ? `Buyer shipping: average from ${shippingCount} comps`
          : "Buyer shipping: manual"
      ].join(" | ");
    }
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
              feeInput.value = String(activeFeePercent);
            }
          }

          saveProfitSettings();
        } else if (input.dataset.profitInput === "buyerShippingChargedMode") {
          state.profitSettings.buyerShippingChargedMode = value;
          const shippingInput = panel.querySelector("[data-profit-input='buyerShippingCharged']");

          if (shippingInput && value === "auto") {
            shippingInput.value = String(getAutoBuyerShippingCharged());
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
      "<dl class='mfs-profit-summary' data-profit-summary>",
      "  <div><dt>Purchase</dt><dd data-profit-value='purchase'></dd></div>",
      "  <div><dt>Expected Sale</dt><dd data-profit-value='expectedSale'></dd></div>",
      "  <div><dt>Expected Net</dt><dd data-profit-value='expectedNet'></dd></div>",
      "  <div><dt>Profit</dt><dd data-profit-value='profit'></dd></div>",
      "  <div><dt>ROI</dt><dd data-profit-value='roi'></dd></div>",
      "  <p data-profit-detail></p>",
      "</dl>",
      "<p class='mfs-profit-hint' data-profit-hint></p>",
      "<div class='mfs-profit-grid' data-profit-controls></div>"
    ].join("");

    const heading = section.querySelector(".mfs-results-heading");
    heading.prepend(createHeadingTitle(
      "Profitability",
      [
        "Purchase - Marketplace asking price or your edited buy cost.",
        "Expected Sale - Median used comp price or your edited sale estimate.",
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
          { value: "auto", label: "Auto from comps" },
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

      const heading = document.createElement("div");
      heading.className = "mfs-results-heading";

      const link = document.createElement("a");
      link.href = resultsUrl || searchUrl;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "Open search";

      heading.append(
        createHeadingTitle(
          "eBay Sold Comps",
          [
            "Used - Accepted comps used for stats, out of all parsed sold candidates.",
            "Median - Middle sold price from used comps; less sensitive to outliers.",
            "Average - Mean sold price from used comps.",
            "Low - Lowest sold price among used comps.",
            "High - Highest sold price among used comps.",
            "Excluded - Parsed results shown but not used because of weak title match or outlier pricing."
          ].join("\n")
        ),
        link
      );

      const statsList = document.createElement("dl");
      statsList.className = "mfs-stats";
      statsList.append(
        renderStat("Used", `${stats.compCount} of ${stats.candidateCount}`),
        renderStat("Median", compsAnalyzer.formatMoney(stats.medianSoldPrice) || "n/a"),
        renderStat("Average", compsAnalyzer.formatMoney(stats.averageSoldPrice) || "n/a"),
        renderStat("Low", compsAnalyzer.formatMoney(stats.lowestSoldPrice) || "n/a"),
        renderStat("High", compsAnalyzer.formatMoney(stats.highestSoldPrice) || "n/a")
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

      comps.forEach((comp) => {
        const item = document.createElement("li");
        item.className = comp.isUsedForStats ? "mfs-comp mfs-comp-used" : "mfs-comp mfs-comp-excluded";

        const row = document.createElement("div");
        row.className = "mfs-comp-topline";

        const price = document.createElement("strong");
        price.textContent = comp.soldPrice || "No price";

        const badge = document.createElement("span");
        badge.textContent = comp.isUsedForStats ? "Used" : "Excluded";

        row.append(price, badge);

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
          comp.shippingPrice || "Shipping n/a"
        ].join(" | ");

        const reason = document.createElement("p");
        reason.className = "mfs-comp-reason";
        reason.textContent = comp.exclusionReasons && comp.exclusionReasons.length
          ? comp.exclusionReasons.join(", ")
          : `Matched: ${(comp.matchedTokens || []).join(", ") || "title terms"}`;

        item.append(row, compTitle, meta, reason);
        list.append(item);
      });

      fragment.append(heading, statsList, note, createProfitabilitySection(), list);
      container.replaceChildren(fragment);
      container.hidden = false;
      bindProfitInputs(container);
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
      setStatus(panel, `Loaded ${state.latestAnalysis.stats.candidateCount} eBay sold candidates.`, false);
    } else if (missingFields.length === 0) {
      setStatus(panel, "Listing captured. Ready to check eBay comps.");
    } else {
      setStatus(panel, `Missing: ${missingFields.join(", ")}. Check DevTools console for details.`, true);
    }

    renderResults(panel);
    updateResizeAvailability(panel);

    const button = panel.querySelector(`#${CHECK_BUTTON_ID}`);
    if (button && !button.dataset.mfsBound) {
      button.dataset.mfsBound = "true";
      button.addEventListener("click", () => {
        const latestInfo = extractListingInfo();
        const currentStatus = panel.querySelector("[data-mfs-field='status']");

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
      resultsUrl: message.resultsUrl
    };

    console.info(DEBUG_PREFIX, "Received eBay sold comps.", state.latestAnalysis);
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
      refresh();
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

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) {
      return false;
    }

    if (message.type === "MFS_EBAY_RESULTS") {
      handleEbayResults(message, sendResponse);
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
