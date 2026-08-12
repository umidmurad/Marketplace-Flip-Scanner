# Marketplace Flip Scanner

Chrome extension for finding eBay comparable listings from an individual Facebook Marketplace listing.

## Current Scope

- Runs on `facebook.com/marketplace/item/*` listing pages.
- Extracts the listing title, asking price, main image URL, and current URL.
- Shows the captured data in a small floating panel.
- Opens an eBay sold/completed listings search in a background tab when `Check eBay` is clicked.
- Extracts sold/completed eBay result candidates from the opened search page.
- Sends those candidates back to the Marketplace panel.
- Closes the background eBay tab after the final extraction pass; use `Open search` to reopen it.
- Displays summary stats and every underlying comp row so the math can be checked.
- Calculates expected net proceeds, expected profit, and ROI from editable assumptions.
- Saves fee, promoted listing, shipping, packaging, and other expense assumptions with Chrome storage.
- Suggests a broad eBay fee category from the Marketplace title, while keeping the actual fee percent editable.
- Can auto-fill buyer-paid shipping from the average shipping amount on used eBay comps when eBay exposes shipping.
- Logs extraction decisions and button payloads to the DevTools console.

This stage calculates comp count, median sold price, average sold price, lowest sold price, highest sold price, expected net proceeds, profit, and ROI. It does not apply final buy/pass scoring yet.

Image-search automation is intentionally not implemented yet. Facebook image URLs are often protected or short-lived, and eBay does not provide a stable no-API image-search flow that is reliable from a Chrome extension content script. The current reliable method is a title-based sold/completed listings search.

Fee category detection is intentionally a suggestion. The extension cannot know the final eBay listing category from a Facebook Marketplace title alone, and eBay fees can vary by category, seller account, store subscription, order total, and policy changes. Use the suggested profile as a starting point and adjust the fee percent when needed.

Shipping is split into two fields: `Buyer Shipping` is the amount the buyer pays and is included in the fee base, while `Shipping Cost` is your postage/label expense and reduces profit.

## Manual Chrome Test

1. Open Chrome and go to `chrome://extensions`.
2. Turn on `Developer mode`.
3. Click `Load unpacked`.
4. Select this project folder: `/Users/umidmuradli/Documents/GitHub/Gem Finder`.
5. Open an individual Facebook Marketplace listing URL, such as `https://www.facebook.com/marketplace/item/...`.
6. Confirm the floating `Flip Scanner` panel appears.
7. Confirm the panel shows title, price, image URL, and listing URL.
8. Open DevTools, then check the Console for logs prefixed with `[Marketplace Flip Scanner]`.
9. Click `Check eBay`.
10. Confirm Chrome opens an eBay background tab with sold and completed listings for the captured title.
11. Wait for the eBay page to finish loading.
12. Return to the original Facebook Marketplace tab.
13. Confirm the `eBay Sold Comps` section appears in the floating panel.
14. Review the raw comp rows. Each row is marked `Used` or `Excluded`, with match percentage and exclusion reason when applicable.
15. Review the `Profitability` section.
16. Change fee, promoted listing, shipping, packaging, or other expense inputs and confirm the net/profit/ROI update.
17. Reload the Marketplace page and confirm those assumption inputs are remembered.
18. Confirm the captured Marketplace payload, eBay URL, and extracted comps are logged in the Console.

If any field says `Not found`, keep the listing open and inspect the console warnings. Facebook changes markup often, so the logs are intended to show which extraction path failed.

## Local Checks

Run these from the project folder:

```sh
node --check src/extractor.js
node --check src/content.js
node --check src/background.js
node --check src/ebaySearch.js
node --check src/ebayResults.js
node test/stage1-smoke.test.js
node test/stage2-ebay-search.test.js
node test/stage3-comps.test.js
node test/stage3-ebay-results.test.js
node test/stage4-profitability.test.js
```
