const assert = require("assert");

const listeners = {};
const timers = [];
const createdTabs = [];
const removedTabs = [];
const sentMessages = [];

global.self = global;
global.importScripts = () => {
  global.MFSEbaySearch = {
    buildSoldListingsSearchUrl() {
      return "https://www.ebay.com/sch/i.html?_nkw=camera&LH_Complete=1&LH_Sold=1";
    }
  };
};
global.setTimeout = (callback, delay) => {
  const timer = { callback, delay, cleared: false };
  timers.push(timer);
  return timer;
};
global.clearTimeout = (timer) => {
  timer.cleared = true;
};

global.chrome = {
  action: {
    onClicked: {
      addListener(listener) {
        listeners.actionClicked = listener;
      }
    }
  },
  runtime: {
    lastError: null,
    onMessage: {
      addListener(listener) {
        listeners.message = listener;
      }
    }
  },
  tabs: {
    create(options, callback) {
      const tab = { id: 100 + createdTabs.length, url: options.url };
      createdTabs.push(tab);
      callback(tab);
    },
    onRemoved: {
      addListener(listener) {
        listeners.tabRemoved = listener;
      }
    },
    remove(tabId, callback) {
      removedTabs.push(tabId);
      callback();
    },
    sendMessage(tabId, message, callback) {
      sentMessages.push({ tabId, message });
      callback({ ok: true });
    }
  }
};

require("../src/background");

let openResponse;
const keepsChannelOpen = listeners.message(
  {
    type: "MFS_OPEN_EBAY_SEARCH",
    listingInfo: { title: "Weston camera" }
  },
  { tab: { id: 42 } },
  (response) => {
    openResponse = response;
  }
);

assert.strictEqual(keepsChannelOpen, true);
assert.strictEqual(openResponse.ok, true);
assert.strictEqual(createdTabs.length, 1);
assert.strictEqual(timers.length, 1);
assert.strictEqual(timers[0].delay, 60000);

timers[0].callback();

assert.strictEqual(removedTabs[0], createdTabs[0].id);
assert.strictEqual(sentMessages[0].tabId, 42);
assert.strictEqual(sentMessages[0].message.type, "MFS_EBAY_SEARCH_STATUS");
assert.strictEqual(sentMessages[0].message.isError, true);
assert.match(sentMessages[0].message.message, /did not finish in time/);

let secondResponse;
listeners.message(
  {
    type: "MFS_OPEN_EBAY_SEARCH",
    listingInfo: { title: "Second camera" }
  },
  { tab: { id: 43 } },
  (response) => {
    secondResponse = response;
  }
);

assert.strictEqual(secondResponse.ok, true);
listeners.tabRemoved(createdTabs[1].id);

const closeMessage = sentMessages[sentMessages.length - 1];
assert.strictEqual(closeMessage.tabId, 43);
assert.strictEqual(closeMessage.message.type, "MFS_EBAY_SEARCH_STATUS");
assert.strictEqual(closeMessage.message.isError, true);
assert.match(closeMessage.message.message, /tab closed before results were ready/);

process.stdout.write("stage6 background lifecycle test ok\n");
