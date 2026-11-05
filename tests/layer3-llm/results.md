# Layer 3 LLM Evaluation Results

**Model:** claude-haiku-4-5-20251001  
**Date:** 2026-11-04  
**Tests:** 13 passed, 0 failed, 0 skipped  
**Duration:** ~6.8s

---

## Results

| Test | File | Result | Time |
|---|---|---|---|
| flight search request → calls search_flights | tool-calling | ✓ | 1373ms |
| city names → converts to IATA codes in search_flights | tool-calling | ✓ | 1057ms |
| seat map request → calls get_flight_seats | tool-calling | ✓ | 830ms |
| booking request → calls create_checkout with offerId not priceUsd | tool-calling | ✓ | 1415ms |
| booking lookup → calls get_booking | tool-calling | ✓ | 868ms |
| seat change request → calls change_seat | tool-calling | ✓ | 1010ms |
| offer UUID is preserved after seat-map turn and additional dialogue | offer-context | ✓ | 1648ms |
| does not call create_checkout when user expresses intent without explicit confirmation | payment-confirmation | ✓ | 1625ms |
| calls create_checkout after user explicitly confirms | payment-confirmation | ✓ | 993ms |
| does not retry checkout when user declines the new price | price-change | ✓ | 1381ms |
| retries checkout with priceChangeToken when user accepts the new price | price-change | ✓ | 1549ms |
| does not retry create_checkout with an expired offer | tool-failure-recovery | ✓ | 2241ms |
| searches for fresh flights when user asks to try again after offer expires | tool-failure-recovery | ✓ | 1273ms |

---

## What these tests cover

**Tool selection (6 tests):** Model picks the right tool for each intent, converts city names to IATA codes, and passes `offerId` (not an invented price) to `create_checkout`.

**Offer context retention (1 test):** Model carries the server-issued offer UUID through an interleaved seat-map turn and books with the original UUID, not a hallucinated one.

**Payment confirmation gate (2 tests):** Model asks for explicit confirmation before calling `create_checkout`. Does not proceed on "I'd like to book" alone — only on "yes, go ahead." This is an LLM behavior guarantee; the backend enforces authorization independently.

**Price change handling (2 tests):** When the backend returns `PRICE_CHANGED`, the model communicates the new price and respects the user's decision. On decline, no retry. On accept, retries with `priceChangeToken` verbatim — this token is the backend's consent signal.

**Tool failure recovery (2 tests):** When `create_checkout` returns `offer_not_found`, the model does not retry with the stale offer. It suggests searching again and calls `search_flights` when prompted.

---

## Responsibility boundary

These tests verify **LLM behavior**, not backend security guarantees.

| Responsibility | Guaranteed by |
|---|---|
| Model retains offer ID | LLM behavior — tested here |
| Price cannot be manipulated | Backend — layer-2 checkout tests |
| User confirmation is requested | LLM behavior — tested here |
| Unconfirmed price cannot be charged | Backend — layer-2 checkout tests |
| Invalid offer cannot be purchased | Backend — layer-2 checkout tests |
| Model recovers from tool failure | LLM behavior — tested here |

---

## Notes

LLM results are not perfectly deterministic. A passing run is evidence of correct behavior, not a permanent guarantee. Re-run with `RUN_LLM_TESTS=1 npx vitest run tests/layer3-llm --reporter=verbose` to verify.
