const router = require("express").Router();
const ctrl = require("../../controllers/public/ticketController");

// Anyone with the lookup code can fetch the QR (guest-friendly)
router.get("/:lookupCode/qr", ctrl.getTicketQr);
router.get("/:lookupCode/qr.svg", ctrl.getTicketQrSvg);

module.exports = router;
