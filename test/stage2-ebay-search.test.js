const assert = require("assert");

global.URLSearchParams = URLSearchParams;

const ebaySearch = require("../src/ebaySearch");

assert.strictEqual(
  ebaySearch.normalizeSearchQuery("  Sony Walkman WM-FX290 - Facebook Marketplace  "),
  "Sony Walkman WM-FX290"
);

assert.strictEqual(
  ebaySearch.normalizeSearchQuery("Vintage Camera • Used"),
  "Vintage Camera"
);

const url = new URL(
  ebaySearch.buildSoldListingsSearchUrl({
    title: "Vintage Sony Walkman WM-FX290 $45"
  })
);

assert.strictEqual(url.origin, "https://www.ebay.com");
assert.strictEqual(url.pathname, "/sch/i.html");
assert.strictEqual(url.searchParams.get("_nkw"), "Vintage Sony Walkman WM-FX290");
assert.strictEqual(url.searchParams.get("LH_Complete"), "1");
assert.strictEqual(url.searchParams.get("LH_Sold"), "1");
assert.strictEqual(url.searchParams.get("_sop"), "13");
assert.strictEqual(url.searchParams.get("_ipg"), "60");

assert.throws(
  () => ebaySearch.buildSoldListingsSearchUrl({ title: "" }),
  /without a listing title/
);

process.stdout.write("stage2 ebay search test ok\n");
