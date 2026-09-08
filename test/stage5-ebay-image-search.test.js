const assert = require("assert");

const imageSearch = require("../src/ebayImageSearch");

assert.strictEqual(imageSearch.getPageStage("https://www.ebay.com/"), "search-entry");
assert.strictEqual(
  imageSearch.getPageStage("https://www.ebay.com/sch/i.html?visualSearchGuid=abc"),
  "image-results"
);
assert.strictEqual(
  imageSearch.getPageStage("https://www.ebay.com/sch/i.html?visualSearchGuid=abc&LH_Complete=1"),
  "completed-results"
);
assert.strictEqual(
  imageSearch.getPageStage("https://www.ebay.com/sch/i.html?visualSearchGuid=abc&LH_Complete=1&LH_Sold=1"),
  "sold-results"
);
assert.strictEqual(
  imageSearch.getPageStage("https://www.ebay.com/splashui/challenge?ap=1"),
  "challenge"
);

assert.strictEqual(
  imageSearch.normalizeImageUrl(" https://scontent.example/photo.jpg?token=abc&size=large "),
  "https://scontent.example/photo.jpg?token=abc&size=large"
);
assert.throws(() => imageSearch.normalizeImageUrl("javascript:alert(1)"), /HTTP or HTTPS/);
assert.throws(() => imageSearch.normalizeImageUrl("not a url"), /invalid/);

const cameraButton = { textContent: "", title: "", getAttribute: () => "Camera icon" };
const imageInput = { value: "" };
const completedLink = { textContent: " Completed Items " };
const soldLink = { textContent: "Sold Items" };
const mockDocument = {
  querySelector(selector) {
    if (selector.includes("button[aria-label='Camera icon']")) {
      return cameraButton;
    }

    if (selector.includes("input[aria-label='Image URL link input']")) {
      return imageInput;
    }

    return null;
  },
  querySelectorAll(selector) {
    if (selector === "a, button, label") {
      return [completedLink, soldLink];
    }

    return [];
  }
};

assert.strictEqual(imageSearch.findCameraButton(mockDocument), cameraButton);
assert.strictEqual(imageSearch.findImageUrlInput(mockDocument), imageInput);
assert.strictEqual(
  imageSearch.findControlByText(mockDocument, "Completed Items", "a, button, label"),
  completedLink
);
assert.strictEqual(
  imageSearch.findControlByText(mockDocument, "Sold Items", "a, button, label"),
  soldLink
);

process.stdout.write("stage5 ebay image search test ok\n");
