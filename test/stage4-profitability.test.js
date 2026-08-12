const assert = require("assert");

const profitability = require("../src/profitability");

assert.deepStrictEqual(profitability.mergeSettings({ ebayFeePercent: 13.25 }), {
  feeProfile: "auto",
  ebayFeePercent: 13.25,
  promotedListingPercent: 0,
  buyerShippingChargedMode: "auto",
  buyerShippingCharged: 0,
  salesTaxPercent: 0,
  shippingExpense: 0,
  packagingExpense: 0,
  otherExpense: 0
});

assert.strictEqual(profitability.suggestFeeProfile("Canon camera lens").id, "camera");
assert.strictEqual(profitability.suggestFeeProfile("Anker power bank").id, "electronics");
assert.strictEqual(profitability.suggestFeeProfile("Vintage wooden chair").id, "most");

const result = profitability.calculateProfitability({
  purchasePrice: 20,
  expectedSalePrice: 50,
  buyerShippingCharged: 8,
  salesTaxPercent: 10,
  ebayFeePercent: 13,
  promotedListingPercent: 2,
  shippingExpense: 6,
  packagingExpense: 1.5,
  otherExpense: 2
});

assert.strictEqual(result.purchasePrice, 20);
assert.strictEqual(result.expectedSalePrice, 50);
assert.strictEqual(result.buyerShippingCharged, 8);
assert.strictEqual(result.estimatedSalesTax, 5.8);
assert.strictEqual(result.feeBase, 63.8);
assert.strictEqual(result.ebaySellingFees, 8.29);
assert.strictEqual(result.promotedListingFees, 1.28);
assert.strictEqual(result.shippingExpense, 6);
assert.strictEqual(result.packagingExpense, 1.5);
assert.strictEqual(result.otherExpense, 2);
assert.strictEqual(result.otherSellingExpenses, 10.78);
assert.strictEqual(result.expectedNetProceeds, 38.93);
assert.strictEqual(result.expectedProfit, 18.93);
assert.strictEqual(result.roiPercent, 94.7);

const noPurchase = profitability.calculateProfitability({
  purchasePrice: 0,
  expectedSalePrice: 25
});

assert.strictEqual(noPurchase.roiPercent, null);

process.stdout.write("stage4 profitability test ok\n");
