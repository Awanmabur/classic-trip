# Classic Trip v1.6.80

## Final rolling-worker regression fix
v1.6.80 fixes the last unit-test failure from the user's v1.6.79 local run. The rolling-worker fixture now distinguishes the rule's existing departure query from the vehicle-overlap query and is timezone-independent across East Africa/Windows and UTC/Render.

The flexible commercial-agreement engine from v1.6.79 is unchanged: Super Admin can configure percentage or fixed earnings by platform, partner, listing, bus fare plan/ticket class, and hotel room type. Promoter rewards and customer discounts come only from Classic Trip's agreed share, while the partner payout remains protected and each booking freezes the terms/version used.

No dependency versions changed.
