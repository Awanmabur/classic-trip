const router = require("express").Router();

const controller = require("../../controllers/tenant/companyController");
const { auth, requireRole } = require("../../middleware/auth");
const validate = require("../../middleware/validation");
const {
  bookingCheckInSchema,
  bookingCustomerNoteSchema,
  bookingLookupSchema,
  bookingPaymentRecordSchema,
  bookingRefundSchema,
  bookingSeatMoveSchema,
  companyDomainCreateSchema,
  companyDomainVerifySchema,
  companyNoticeSchema,
  companySettingsSchema,
  manualBookingCreateSchema,
  payoutRequestSchema,
  routeUpdateSchema,
  staffInviteCreateSchema,
  staffStatusSchema,
  supportCaseUpdateSchema,
  tripUpdateSchema,
  vehicleUpdateSchema
} = require("../../validation");

router.get("/staff", auth, requireRole("partner", "company_admin", "admin", "super_admin"), controller.staff);
router.post("/staff/invites", auth, requireRole("partner", "company_admin", "admin", "super_admin"), validate(staffInviteCreateSchema), controller.createStaffInvite);
router.post("/staff/invites/:id/resend", auth, requireRole("partner", "company_admin", "admin", "super_admin"), controller.resendStaffInvite);
router.post("/staff/invites/:id/revoke", auth, requireRole("partner", "company_admin", "admin", "super_admin"), controller.revokeStaffInvite);
router.patch("/staff/:id/status", auth, requireRole("partner", "company_admin", "admin", "super_admin"), validate(staffStatusSchema), controller.setStaffStatus);

router.get("/settings", auth, requireRole("partner", "company_admin", "company_employee", "admin", "super_admin"), controller.settings);
router.patch("/settings", auth, requireRole("partner", "company_admin", "admin", "super_admin"), validate(companySettingsSchema), controller.updateSettings);
router.post("/domains", auth, requireRole("partner", "company_admin", "admin", "super_admin"), validate(companyDomainCreateSchema), controller.createDomain);
router.post("/domains/:id/verify", auth, requireRole("partner", "company_admin", "admin", "super_admin"), validate(companyDomainVerifySchema), controller.verifyDomain);
router.delete("/domains/:id", auth, requireRole("partner", "company_admin", "admin", "super_admin"), controller.removeDomain);
router.get("/notices", auth, requireRole("partner", "company_admin", "company_employee", "admin", "super_admin"), controller.notices);
router.get("/payout-requests", auth, requireRole("partner", "company_admin", "company_employee", "admin", "super_admin"), controller.payoutRequests);
router.get("/reviews", auth, requireRole("partner", "company_admin", "company_employee", "admin", "super_admin"), controller.reviews);

router.patch("/routes/:id", auth, requireRole("partner", "company_admin", "admin", "super_admin"), validate(routeUpdateSchema), controller.updateRoute);
router.patch("/vehicles/:id", auth, requireRole("partner", "company_admin", "admin", "super_admin"), validate(vehicleUpdateSchema), controller.updateVehicle);
router.patch("/trips/:id", auth, requireRole("partner", "company_admin", "admin", "super_admin"), validate(tripUpdateSchema), controller.updateTrip);
router.get("/bookings/lookup", auth, requireRole("partner", "company_admin", "company_employee", "admin", "super_admin"), validate(bookingLookupSchema), controller.lookupBookings);
router.post("/bookings/manual", auth, requireRole("partner", "company_admin", "company_employee", "admin", "super_admin"), validate(manualBookingCreateSchema), controller.manualBooking);
router.post("/bookings/:id/payments", auth, requireRole("partner", "company_admin", "company_employee", "admin", "super_admin"), validate(bookingPaymentRecordSchema), controller.recordBookingPayment);
router.post("/bookings/:id/check-in", auth, requireRole("partner", "company_admin", "company_employee", "admin", "super_admin"), validate(bookingCheckInSchema), controller.checkInBooking);
router.post("/bookings/:id/move-seat", auth, requireRole("partner", "company_admin", "company_employee", "admin", "super_admin"), validate(bookingSeatMoveSchema), controller.moveBookingSeat);
router.post("/bookings/:id/customer-notes", auth, requireRole("partner", "company_admin", "company_employee", "admin", "super_admin"), validate(bookingCustomerNoteSchema), controller.addCustomerNote);
router.post("/bookings/:id/refund", auth, requireRole("partner", "company_admin", "company_employee", "admin", "super_admin"), validate(bookingRefundSchema), controller.refundBooking);

router.post("/notices", auth, requireRole("partner", "company_admin", "company_employee", "admin", "super_admin"), validate(companyNoticeSchema), controller.createNotice);
router.post("/payout-requests", auth, requireRole("partner", "company_admin", "admin", "super_admin"), validate(payoutRequestSchema), controller.createPayoutRequest);

router.get("/support", auth, requireRole("partner", "company_admin", "company_employee", "admin", "super_admin"), controller.supportCases);
router.patch("/support/:id", auth, requireRole("partner", "company_admin", "company_employee", "admin", "super_admin"), validate(supportCaseUpdateSchema), controller.updateSupportCase);

router.get("/reports/:type", auth, requireRole("partner", "company_admin", "company_employee", "admin", "super_admin"), controller.report);

module.exports = router;
