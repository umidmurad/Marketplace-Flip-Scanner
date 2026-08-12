const assert = require("assert");

function rect(width, height, left = 0) {
  return { width, height, left };
}

function element({ textContent = "", content = "", src = "", alt = "", width = 0, height = 0, left = 0, tagName = "DIV", role = "", ariaLevel = "" } = {}) {
  return {
    tagName,
    textContent,
    alt,
    src,
    currentSrc: src,
    naturalWidth: width,
    naturalHeight: height,
    getAttribute(name) {
      if (name === "role") {
        return role;
      }

      if (name === "aria-level") {
        return ariaLevel;
      }

      return name === "content" ? content : "";
    },
    getBoundingClientRect() {
      return rect(width, height, left);
    }
  };
}

const meta = {
  "meta[property='og:title']": element({ content: "Vintage Sony Walkman WM-FX290 | Facebook Marketplace" }),
  "meta[property='og:description']": element({ content: "$45 listed in Seattle, WA" }),
  "meta[property='og:image']": element({ content: "https://scontent.example/listing-main.jpg" })
};

global.document = {
  title: "Fallback Marketplace Title",
  images: [
    element({ src: "https://static.example/icon.png", width: 32, height: 32 }),
    element({ src: "https://scontent.example/visible-photo.jpg", width: 800, height: 600 })
  ],
  querySelector(selector) {
    return meta[selector] || null;
  },
  querySelectorAll(selector) {
    if (selector.includes("role='heading'")) {
      return [element({ textContent: "Visible Fallback Title", width: 500, height: 40 })];
    }

    return [element({ textContent: "Listed today for $45", width: 300, height: 20 })];
  }
};

global.location = {
  href: "https://www.facebook.com/marketplace/item/123456789/"
};

global.getComputedStyle = () => ({
  display: "block",
  visibility: "visible"
});

global.console = {
  debug() {},
  info() {},
  log() {},
  warn() {}
};

const extractor = require("../src/extractor");
const info = extractor.extractListingInfo();

assert.strictEqual(info.title, "Vintage Sony Walkman WM-FX290");
assert.strictEqual(info.askingPrice, "$45");
assert.strictEqual(info.mainImageUrl, "https://scontent.example/listing-main.jpg");
assert.strictEqual(info.listingUrl, "https://www.facebook.com/marketplace/item/123456789/");
assert.strictEqual(extractor.parsePriceText("USD 1,250.00 listed"), "USD 1,250.00");

global.document = {
  title: "Facebook",
  documentElement: { clientWidth: 2048 },
  images: [],
  querySelector() {
    return null;
  },
  querySelectorAll(selector) {
    if (selector.includes("heading")) {
      return [
        element({ textContent: "Chats", width: 240, height: 36, left: 64, role: "heading" }),
        element({ textContent: "Details", width: 240, height: 36, left: 1520, role: "heading" })
      ];
    }

    return [
      element({
        textContent: "Used Honeywell barcode scanner model 1900GSR-2. It’s a wired reader. Connects to your system via usb. Good condition.",
        width: 430,
        height: 96,
        left: 1520
      }),
      element({ textContent: "Buying", width: 140, height: 30, left: 64 })
    ];
  }
};

global.innerWidth = 2048;

assert.strictEqual(extractor.getTitle(), "Used Honeywell barcode scanner model 1900GSR-2");

process.stdout.write("stage1 smoke test ok\n");
