const assert = require("assert");

const comps = require("../src/comps");

assert.strictEqual(comps.parseMoney("$1,250.00"), 1250);
assert.strictEqual(comps.parseMoney("Free shipping"), 0);
assert.strictEqual(comps.parseMoney("$20.00 to $30.00"), 25);

const analysis = comps.analyzeComps(
  { title: "Sony Walkman WM-FX290 Portable Cassette Player" },
  [
    {
      title: "Sony Walkman WM-FX290 Portable Cassette Player Radio",
      soldPrice: "$40.00",
      shippingPrice: "$6.00",
      saleDate: "Jul 31, 2026",
      listingUrl: "https://www.ebay.com/itm/1"
    },
    {
      title: "Sony Walkman WM-FX290 AM FM Cassette Player",
      soldPrice: "$45.00",
      shippingPrice: "Free shipping",
      saleDate: "Aug 7, 2026",
      listingUrl: "https://www.ebay.com/itm/2"
    },
    {
      title: "Sony Walkman WM-FX290 Tested Working",
      soldPrice: "$50.00",
      shippingPrice: "$5.00",
      saleDate: "Aug 9, 2026",
      listingUrl: "https://www.ebay.com/itm/3"
    },
    {
      title: "Sony Walkman WM-FX290 Sealed Collector Grade",
      soldPrice: "$500.00",
      shippingPrice: "$12.00",
      saleDate: "Aug 10, 2026",
      listingUrl: "https://www.ebay.com/itm/4"
    },
    {
      title: "Apple iPod Nano 7th Generation",
      soldPrice: "$42.00",
      shippingPrice: "$4.00",
      saleDate: "Aug 11, 2026",
      listingUrl: "https://www.ebay.com/itm/5"
    }
  ]
);

assert.strictEqual(analysis.stats.candidateCount, 5);
assert.strictEqual(analysis.stats.comparableCount, 4);
assert.strictEqual(analysis.stats.outlierCount, 1);
assert.strictEqual(analysis.stats.compCount, 3);
assert.strictEqual(analysis.stats.medianSoldPrice, 45);
assert.strictEqual(analysis.stats.averageSoldPrice, 45);
assert.strictEqual(analysis.stats.lowestSoldPrice, 40);
assert.strictEqual(analysis.stats.highestSoldPrice, 50);
assert.strictEqual(analysis.stats.medianShippingPrice, 5);
assert.strictEqual(Math.round(analysis.stats.averageShippingPrice * 100) / 100, 3.67);
assert.strictEqual(analysis.stats.shippingCompCount, 3);
assert.deepStrictEqual(
  analysis.comps.map((comp) => comp.listingUrl),
  [
    "https://www.ebay.com/itm/3",
    "https://www.ebay.com/itm/2",
    "https://www.ebay.com/itm/1",
    "https://www.ebay.com/itm/5",
    "https://www.ebay.com/itm/4"
  ]
);

const unrelated = analysis.comps.find((comp) => comp.listingUrl.endsWith("/5"));
assert.strictEqual(unrelated.isComparable, false);
assert.ok(unrelated.exclusionReasons.includes("Low title similarity"));

const outlier = analysis.comps.find((comp) => comp.listingUrl.endsWith("/4"));
assert.strictEqual(outlier.isOutlier, true);
assert.strictEqual(outlier.isUsedForStats, false);

process.stdout.write("stage3 comps test ok\n");
