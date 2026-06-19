# Master Acceptance Matrix - Section N

This matrix maps every required Section N acceptance criterion from the master document to executable test evidence in this project.

| ID | Section(s) | Acceptance criterion | Evidence |
|---|---|---|---|
| N-01 | A | Super Admin creates lead, records session/agreement, and sends company invite. | `tests/integration/onboardingAComplete.test.js` |
| N-02 | A | Company accepts invite, sets up account, uploads documents, and waits for verification. | `tests/integration/onboardingAComplete.test.js` |
| N-03 | A/C | Super Admin verifies company; company can now publish inventory. | `tests/integration/onboardingAComplete.test.js`<br>`tests/integration/busOperationsC.test.js` |
| N-04 | A/B | Super Admin invites driver or approves company driver request; driver accepts and sees assigned trips. | `tests/integration/onboardingAComplete.test.js`<br>`tests/integration/companyDriverOperationsB.test.js` |
| N-05 | B/C | Company creates route, vehicle, seat map, schedule, fare, and driver assignment. | `tests/integration/companyDriverOperationsB.test.js`<br>`tests/integration/busOperationsC.test.js` |
| N-06 | C/G/I | Customer books one-way bus ticket. | `tests/integration/bookingFlow.test.js`<br>`tests/integration/ticketQrCheckinG.test.js`<br>`tests/integration/financeWalletSettlementI.test.js` |
| N-07 | C/G | Customer books round-trip/two-way bus ticket. | `tests/integration/busOperationsC.test.js`<br>`tests/integration/ticketQrCheckinG.test.js` |
| N-08 | C/E/F/G | Customer buys multiple seats/tickets for multiple passengers in one checkout. | `tests/integration/busOperationsC.test.js`<br>`tests/integration/multiServiceCartE.test.js`<br>`tests/integration/customerPassengerManifestF.test.js` |
| N-09 | D/E | Customer books hotel room and multiple rooms. | `tests/integration/hotelOperationsD.test.js`<br>`tests/integration/multiServiceCartE.test.js` |
| N-10 | C/D/E | Seat/room hold expires and inventory returns to available. | `tests/integration/busOperationsC.test.js`<br>`tests/integration/hotelOperationsD.test.js`<br>`tests/integration/multiServiceCartE.test.js` |
| N-11 | F/G | Booked seat appears on visual seat map; employee clicks it and opens ticket detail. | `tests/integration/customerPassengerManifestF.test.js`<br>`tests/integration/ticketQrCheckinG.test.js` |
| N-12 | F | Route/vehicle/customer manifest page prints cleanly and exports PDF/CSV. | `tests/integration/customerPassengerManifestF.test.js`<br>`tests/integration/driverManifestPrint.test.js` |
| N-13 | G/I/M | Payment webhook success creates tickets, receipts, notifications, ledger entries, and commissions. | `tests/integration/bookingFlow.test.js`<br>`tests/integration/financeWalletSettlementI.test.js`<br>`tests/integration/securityReliabilityM.test.js` |
| N-14 | G/M | QR scan checks in the customer once and rejects a second scan. | `tests/integration/ticketQrCheckinG.test.js`<br>`tests/integration/securityReliabilityM.test.js` |
| N-15 | F/G | Driver/employee manifest updates after check-in and no-show. | `tests/integration/customerPassengerManifestF.test.js`<br>`tests/integration/ticketQrCheckinG.test.js` |
| N-16 | H/I | Refund reverses ticket status, inventory, ledger, commission, and notifications correctly. | `tests/integration/supportTimeline.test.js`<br>`tests/integration/financeSettlement.test.js`<br>`tests/integration/financeWalletSettlementI.test.js` |
| N-17 | J/I | Promoter referral link attributes booking and releases commission after check-in/completion. | `tests/integration/bookingFlow.test.js`<br>`tests/integration/promoterAgentSystemJ.test.js`<br>`tests/integration/financeSettlement.test.js` |
| N-18 | H | Support correspondence appears on booking timeline and sends notification attempts. | `tests/integration/correspondenceSupportH.test.js`<br>`tests/integration/supportTimeline.test.js` |
| N-19 | A/C/E/M | Suspended or unverified company cannot publish or receive bookings. | `tests/integration/onboardingAComplete.test.js`<br>`tests/integration/busOperationsC.test.js`<br>`tests/integration/multiServiceCartE.test.js`<br>`tests/integration/securityReliabilityM.test.js` |
| N-20 | L | Unified dashboard sidebar renders consistently across all roles. | `tests/integration/unifiedDashboardLayoutL.test.js` |
| N-21 | K/E | Future services are either fully bookable or safely hidden/coming soon without broken flows. | `tests/integration/futureServicesK.test.js`<br>`tests/integration/multiServiceCartE.test.js` |
