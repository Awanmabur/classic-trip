const { z } = require("zod");

function trimmedString({ min = 0, max = 200 } = {}) {
  let schema = z.string().trim();
  if (min > 0) schema = schema.min(min);
  if (max) schema = schema.max(max);
  return schema;
}

function optionalString(max = 500) {
  return z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal(""));
}

function coerceNumber({ min, max, integer = false }) {
  return z.preprocess((value) => {
    if (value === "" || value == null) return undefined;
    return Number(value);
  }, integer ? z.number().int().min(min).max(max) : z.number().min(min).max(max));
}

function coerceBoolean(defaultValue = false) {
  return z.preprocess((value) => {
    if (value == null || value === "") return defaultValue;
    if (typeof value === "boolean") return value;
    return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
  }, z.boolean());
}

const seatArray = z
  .array(trimmedString({ min: 1, max: 20 }))
  .min(1, "Select at least one seat.")
  .max(8, "You can only book up to 8 seats at once.");

const objectIdLike = trimmedString({ min: 8, max: 64 });
const currencyCode = trimmedString({ min: 3, max: 8 }).transform((value) => value.toUpperCase());

const registerSchema = z.object({
  body: z.object({
    name: trimmedString({ min: 2, max: 80 }),
    email: z.string().trim().email(),
    password: z.string().min(8).max(128),
    phone: optionalString(40),
    role: z.enum(["customer", "promoter", "company_admin", "company_employee"]).default("customer"),
    companyEmail: optionalString(120)
  })
});

const loginSchema = z.object({
  body: z.object({
    email: z.string().trim().email(),
    password: z.string().min(1).max(128)
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

const tripCreateSchema = z.object({
  body: z
    .object({
      routeId: objectIdLike,
      vehicleId: objectIdLike,
      departureAt: z.string().trim().datetime({ offset: true }).or(z.string().trim().min(16)),
      arriveAt: optionalString(40),
      basePrice: coerceNumber({ min: 0, max: 1_000_000_000 }),
      currency: currencyCode.default("UGX")
    })
    .refine((body) => Number.isFinite(body.basePrice) && body.basePrice >= 0, "Base price must be valid.")
});

const routeCreateSchema = z.object({
  body: z
    .object({
      type: z.enum(["bus", "train", "flight", "hotel"]),
      title: trimmedString({ min: 3, max: 120 }),
      description: optionalString(1200),
      country: optionalString(80),
      city: optionalString(80),
      from: optionalString(80),
      to: optionalString(80),
      address: optionalString(200),
      stars: coerceNumber({ min: 0, max: 5, integer: true }).optional(),
      amenities: optionalString(300),
      policy: optionalString(1200),
      currency: currencyCode.default("UGX")
    })
    .refine(
      (body) => {
        if (body.type === "hotel") return true;
        return Boolean(body.from && body.to);
      },
      { message: "From and To are required for transport routes." }
    )
});

const vehicleCreateSchema = z.object({
  body: z.object({
    type: z.enum(["bus", "train", "flight", "hotel"]),
    name: trimmedString({ min: 2, max: 120 }),
    plateOrCode: optionalString(60),
    layoutName: z.enum(["2x2", "2x3", "custom"]).default("2x2"),
    rows: coerceNumber({ min: 1, max: 100, integer: true }),
    cols: coerceNumber({ min: 1, max: 20, integer: true }).optional(),
    seats: z.any().optional()
  })
});

module.exports = {
  registerSchema,
  loginSchema,
  seatHoldSchema,
  bookingConfirmSchema,
  guestBookingSchema,
  tripCreateSchema,
  routeCreateSchema,
  vehicleCreateSchema
};
