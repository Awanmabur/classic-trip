const {
  z,
  trimmedString,
  optionalString,
  coerceBoolean,
  seatArray,
  objectIdLike
} = require("./helpers");

const supportRequestSchema = z.object({
  body: z.object({
    name: trimmedString({ min: 2, max: 80 }),
    contact: trimmedString({ min: 3, max: 120 }),
    topic: trimmedString({ min: 2, max: 80 }),
    bookingReference: optionalString(80),
    message: trimmedString({ min: 10, max: 2000 })
  })
});

const partnerInquirySchema = z.object({
  body: z.object({
    companyName: trimmedString({ min: 2, max: 120 }),
    businessType: trimmedString({ min: 2, max: 80 }),
    country: trimmedString({ min: 2, max: 80 }),
    contactName: trimmedString({ min: 2, max: 80 }),
    email: z.string().trim().email(),
    phone: trimmedString({ min: 4, max: 40 })
  })
});

const recoveryRequestSchema = z.object({
  body: z.object({
    identity: trimmedString({ min: 3, max: 120 })
  })
});

const seatHoldSchema = z.object({
  body: z.object({
    seats: seatArray
  })
});

const bookingConfirmSchema = z.object({
  body: z.object({
    tripId: objectIdLike,
    seats: seatArray,
    paymentProvider: optionalString(40).default("none"),
    paymentRef: optionalString(120).default(""),
    referralCode: optionalString(40).default(""),
    useWallet: coerceBoolean(false)
  })
});

const guestBookingSchema = z.object({
  body: z.object({
    tripId: objectIdLike,
    seats: seatArray,
    referralCode: optionalString(40).default(""),
    guest: z
      .object({
        name: optionalString(80),
        email: optionalString(120),
        phone: optionalString(40)
      })
      .refine(
        (guest) => [guest.name, guest.email, guest.phone].some((value) => String(value || "").trim()),
        "Guest name, email, or phone is required."
      )
  })
});

module.exports = {
  supportRequestSchema,
  partnerInquirySchema,
  recoveryRequestSchema,
  seatHoldSchema,
  bookingConfirmSchema,
  guestBookingSchema
};
