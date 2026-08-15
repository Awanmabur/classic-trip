# Classic Trip v1.6.85

## Exact amenity fit + light notification contrast

- Fixed the real reason the bottom amenity lane was still cut off: Card amenity content occupied 58px inside a 54px scroller and Bar content occupied 56px inside a 52px scroller because of vertical padding.
- Removed only that vertical padding, so both lanes fit their existing height exactly. **No extra bottom gap or card/bar height was added.**
- Kept amenity chips above the lower price/actions layer on both Cards and Bars.
- Fixed light-mode notification contrast on public pages by using the page card color when `--panel` is unavailable, plus explicit light-theme foreground/background guards.
- Kept Pesapal's four-minute keep-warm behavior but stopped successful refreshes from spamming production `info` logs; only the first success is informational and later successful refreshes are debug-level.
- Retains v1.6.84 warm bus schedule-context and ticket-listing lookup improvements.
- Retains the valid `paymentInitiationStatus: pending` payment state and same-origin Pesapal handoff.
- No dependency versions changed.
