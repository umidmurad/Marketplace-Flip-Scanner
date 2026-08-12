# Marketplace Flip Scanner

## Project Goal

Build a Chrome extension that helps me find profitable items on
Facebook Marketplace by comparing Marketplace prices against
recent eBay sold listings.

## Intended Workflow

1. User opens a Facebook Marketplace listing.
2. Extension identifies:
   - Item title
   - Asking price
   - Main image
   - Marketplace URL

3. User clicks "Check eBay."

4. Extension finds comparable eBay sold listings.

5. System calculates:
   - Median sold price
   - Average sold price
   - Estimated eBay fees
   - Estimated shipping
   - Estimated net proceeds
   - Estimated profit
   - ROI

6. Extension rates the opportunity:
   - GREAT BUY
   - GOOD BUY
   - MARGINAL
   - PASS

## Development Rules

Build incrementally.

Do NOT try to implement the entire project at once.

For every stage:
- Preserve working functionality.
- Test changes.
- Keep code modular.
- Explain important architectural decisions.
- Do not silently introduce fragile workarounds.
- Do not hard-code fees or assumptions that should be configurable.
- Prefer reliable solutions over clever ones.

## Current Development Stage

Stage 1:
Build the Chrome extension skeleton and reliably extract information
from a single Facebook Marketplace listing.

Do not implement later stages until Stage 1 works.