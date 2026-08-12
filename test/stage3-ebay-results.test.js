const assert = require("assert");

function makeElement({ text = "", href = "", children = {} } = {}) {
  const node = {
    href,
    textContent: text,
    innerText: text,
    parentElement: null,
    querySelector(selector) {
      if (selector === "a[href*='/itm/']") {
        return children.link || null;
      }

      return children[selector] || null;
    },
    querySelectorAll(selector) {
      if (selector.includes("a[href*=")) {
        return children.link ? [children.link] : [];
      }

      return Object.entries(children)
        .filter(([key]) => selector.split(",").map((part) => part.trim()).includes(key))
        .flatMap(([, child]) => Array.isArray(child) ? child : [child]);
    },
    closest(selector) {
      if (selector === "li" || selector === "div" || selector.includes("s-item")) {
        return node.parentElement || node;
      }

      return node;
    }
  };

  Object.values(children).forEach((child) => {
    if (child && typeof child === "object") {
      child.parentElement = node;
    }
  });

  return node;
}

const first = makeElement({
  text: "Sony Walkman WM-FX290 Sold Aug 8, 2026 $45.00 +$6.00 shipping Used",
  children: {
    "a[href*='/itm/']": makeElement({ href: "https://www.ebay.com/itm/123?hash=abc" }),
    link: makeElement({ href: "https://www.ebay.com/itm/123?hash=abc", text: "Sony Walkman WM-FX290 Cassette Player" }),
    ".s-item__title": makeElement({ text: "Sony Walkman WM-FX290 Cassette Player" }),
    ".s-item__price": makeElement({ text: "$45.00" }),
    ".s-item__shipping": makeElement({ text: "+$6.00 shipping" }),
    ".SECONDARY_INFO": makeElement({ text: "Used" })
  }
});

const duplicate = makeElement({
  text: first.textContent,
  children: {
    link: makeElement({ href: "https://www.ebay.com/itm/123?hash=abc", text: "Sony Walkman WM-FX290 Cassette Player" }),
    ".s-item__title": makeElement({ text: "Sony Walkman WM-FX290 Cassette Player" }),
    ".s-item__price": makeElement({ text: "$45.00" }),
    ".s-item__shipping": makeElement({ text: "+$6.00 shipping" }),
    ".SECONDARY_INFO": makeElement({ text: "Used" })
  }
});

const unsold = makeElement({
  text: "Sony Walkman WM-FX290 $99.00",
  children: {
    link: makeElement({ href: "https://www.ebay.com/itm/999", text: "Sony Walkman WM-FX290" }),
    ".s-item__title": makeElement({ text: "Sony Walkman WM-FX290" }),
    ".s-item__price": makeElement({ text: "$99.00" })
  }
});

const textOnlyShipping = makeElement({
  text: "Anker Power Bank Sold Aug 10, 2026 $29.99 +$4.99 shipping Open Box",
  children: {
    link: makeElement({ href: "https://www.ebay.com/itm/456", text: "Anker Power Bank" }),
    ".s-item__title": makeElement({ text: "Anker Power Bank" }),
    ".s-item__price": makeElement({ text: "$29.99" }),
    ".SECONDARY_INFO": makeElement({ text: "Open Box" })
  }
});

const freeShipping = makeElement({
  text: "Anker Power Bank Sold Aug 11, 2026 $34.99 Free delivery Brand New",
  children: {
    link: makeElement({ href: "https://www.ebay.com/itm/789", text: "Anker Power Bank New" }),
    ".s-item__title": makeElement({ text: "Anker Power Bank New" }),
    ".s-item__price": makeElement({ text: "$34.99" }),
    ".SECONDARY_INFO": makeElement({ text: "Brand New" })
  }
});

const deliveryCost = makeElement({
  text: "Honeywell Xenon 1900 Sold Aug 4, 2026 $26.00 +$12.00 delivery Pre-Owned",
  children: {
    link: makeElement({ href: "https://www.ebay.com/itm/321", text: "Honeywell Xenon 1900 Barcode Scanner" }),
    ".s-item__title": makeElement({ text: "Honeywell Xenon 1900 Barcode Scanner" }),
    ".s-item__price": makeElement({ text: "$26.00" }),
    ".SECONDARY_INFO": makeElement({ text: "Pre-Owned" })
  }
});

const nestedDeliveryLink = makeElement({
  href: "https://www.ebay.com/itm/654?hash=abc",
  text: "Honeywell Barcode Scanner 1900GSR-2"
});
const nestedDeliveryTitle = makeElement({
  text: "Honeywell Barcode Scanner 1900GSR-2",
  children: {
    link: nestedDeliveryLink
  }
});
const nestedDelivery = makeElement({
  text: "Sold Aug 5, 2026 Honeywell Barcode Scanner 1900GSR-2 Pre-Owned $24.99 Free delivery Located in United States",
  children: {
    link: nestedDeliveryLink,
    ".s-item__title": nestedDeliveryTitle,
    ".s-item__price": makeElement({ text: "$24.99" }),
    ".SECONDARY_INFO": makeElement({ text: "Pre-Owned" })
  }
});
nestedDeliveryLink.parentElement = nestedDeliveryTitle;
nestedDeliveryTitle.parentElement = nestedDelivery;

const attributeRowDelivery = makeElement({
  text: "Sold Aug 11, 2026 Lot of 4 Honeywell Xenon 1900 Pre-Owned $37.49 or Best Offer Free delivery Located in United States",
  children: {
    link: makeElement({ href: "https://www.ebay.com/itm/777", text: "Lot of 4 Honeywell Xenon 1900" }),
    ".s-card__title": makeElement({ text: "Lot of 4 Honeywell Xenon 1900" }),
    ".s-card__price": makeElement({ text: "$37.49" }),
    ".s-card__subtitle": makeElement({ text: "Pre-Owned" }),
    ".s-card__attribute-row": [
      makeElement({ text: "$37.49 $49.99" }),
      makeElement({ text: "or Best Offer" }),
      makeElement({ text: "Free delivery" }),
      makeElement({ text: "Located in United States" })
    ]
  }
});

global.location = {
  pathname: "/sch/i.html",
  search: "?_nkw=sony+walkman"
};

global.document = {
  querySelectorAll() {
    return [first, duplicate, unsold, textOnlyShipping, freeShipping, deliveryCost, nestedDeliveryLink, attributeRowDelivery];
  }
};

global.console = {
  debug() {},
  warn() {}
};

const ebayResults = require("../src/ebayResults");
const results = ebayResults.extractSoldResults();

assert.strictEqual(results.length, 6);
assert.strictEqual(results[0].title, "Sony Walkman WM-FX290 Cassette Player");
assert.strictEqual(results[0].soldPrice, "$45.00");
assert.strictEqual(results[0].shippingPrice, "$6.00");
assert.strictEqual(results[0].condition, "Used");
assert.strictEqual(results[0].saleDate, "Aug 8, 2026");
assert.strictEqual(results[0].listingUrl, "https://www.ebay.com/itm/123");

const textOnly = results.find((result) => result.listingUrl.endsWith("/456"));
assert.strictEqual(textOnly.shippingPrice, "$4.99");

const free = results.find((result) => result.listingUrl.endsWith("/789"));
assert.strictEqual(free.shippingPrice, "Free shipping");

const delivery = results.find((result) => result.listingUrl.endsWith("/321"));
assert.strictEqual(delivery.shippingPrice, "$12.00");

const nested = results.find((result) => result.listingUrl.endsWith("/654"));
assert.strictEqual(nested.shippingPrice, "Free shipping");

const attributeRow = results.find((result) => result.listingUrl.endsWith("/777"));
assert.strictEqual(attributeRow.shippingPrice, "Free shipping");

process.stdout.write("stage3 ebay results test ok\n");
