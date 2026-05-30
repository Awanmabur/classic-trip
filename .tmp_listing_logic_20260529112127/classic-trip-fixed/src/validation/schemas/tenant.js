const {
  z,
  coerceBoolean,
  trimmedString,
  optionalString,
  coerceNumber,
  currencyCode,
  hostnameLike,
  objectIdLike,
  seatArray
} = require("./helpers");

const hexColorValue = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-fA-F]{6})$/, "Use a full hex color like #ffb703")
  .transform((value) => value.toLowerCase());

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

const tripUpdateSchema = z.object({
  body: z.object({
    departureAt: z.string().trim().datetime({ offset: true }).or(z.string().trim().min(16)).optional(),
    arriveAt: optionalString(40),
    basePrice: coerceNumber({ min: 0, max: 1_000_000_000 }).optional(),
    currency: currencyCode.optional(),
    status: z.enum(["scheduled", "closed", "cancelled"]).optional()
  })
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

const routeUpdateSchema = z.object({
  body: z.object({
    title: trimmedString({ min: 3, max: 120 }).optional(),
    description: optionalString(1200),
    country: optionalString(80),
    city: optionalString(80),
    from: optionalString(80),
    to: optionalString(80),
    address: optionalString(200),
    stars: coerceNumber({ min: 0, max: 5, integer: true }).optional(),
    amenities: optionalString(300),
    policy: optionalString(1200),
    currency: currencyCode.optional(),
    isActive: coerceBoolean().optional()
  })
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

const vehicleUpdateSchema = z.object({
  body: z.object({
    name: trimmedString({ min: 2, max: 120 }).optional(),
    plateOrCode: optionalString(60),
    status: z.enum(["active", "maintenance", "archived"]).optional()
  })
});

const companySettingsSchema = z.object({
  body: z.object({
    companyName: trimmedString({ min: 2, max: 120 }),
    businessType: trimmedString({ min: 2, max: 80 }),
    country: trimmedString({ min: 2, max: 80 }),
    companyCurrency: currencyCode.default("UGX"),
    payoutAccount: optionalString(160),
    supportMessage: optionalString(1200),
    phone: optionalString(40),
    timezone: trimmedString({ min: 3, max: 80 }).default("Africa/Kampala"),
    brandName: optionalString(120),
    brandShortName: optionalString(6),
    supportEmail: z.string().trim().email().optional().or(z.literal("")),
    supportPhone: optionalString(40),
    authTitle: optionalString(120),
    authSubtitle: optionalString(280),
    marketplaceTitle: optionalString(140),
    marketplaceSubtitle: optionalString(320),
    marketplaceIntro: optionalString(400),
    supportHeadline: optionalString(120),
    supportBlurb: optionalString(320),
    featureOneTitle: optionalString(120),
    featureOneBody: optionalString(280),
    featureTwoTitle: optionalString(120),
    featureTwoBody: optionalString(280),
    featureThreeTitle: optionalString(120),
    featureThreeBody: optionalString(280),
    promoHeadline: optionalString(140),
    promoBody: optionalString(320),
    primaryColor: hexColorValue.optional().or(z.literal("")),
    accentColor: hexColorValue.optional().or(z.literal("")),
    hotColor: hexColorValue.optional().or(z.literal(""))
  })
});

const companyDomainCreateSchema = z.object({
  body: z.object({
    hostname: hostnameLike
  })
});

const companyDomainVerifySchema = z.object({
  body: z.object({
    makePrimary: coerceBoolean(false).optional()
  })
});

const staffInviteCreateSchema = z.object({
  body: z.object({
    name: trimmedString({ min: 2, max: 120 }),
    email: trimmedString({ min: 6, max: 120 }).email(),
    phone: optionalString(40),
    jobTitle: trimmedString({ min: 2, max: 80 }),
    permissionsLabel: trimmedString({ min: 2, max: 120 }),
    notes: optionalString(500)
  })
});

const staffStatusSchema = z.object({
  body: z.object({
    status: z.enum(["active", "suspended"])
  })
});

const payoutRequestSchema = z.object({
  body: z.object({
    amount: coerceNumber({ min: 1, max: 1_000_000_000 }),
    currency: currencyCode.default("UGX"),
    destination: trimmedString({ min: 3, max: 160 }),
    note: optionalString(500)
  })
});

const companyNoticeSchema = z.object({
  body: z.object({
    audience: z.enum(["customers_on_selected_trip", "all_customers_today", "staff_only"]),
    priority: z.enum(["normal", "high", "urgent"]),
    message: trimmedString({ min: 8, max: 1200 }),
    tripId: objectIdLike.optional().or(z.literal(""))
  })
});

const supportCaseUpdateSchema = z.object({
  body: z.object({
    status: z.enum(["new", "open", "resolved", "closed"]),
    notes: optionalString(500)
  })
});

const bookingPaymentRecordSchema = z.object({
  body: z.object({
    method: z.enum(["cash", "mobile_money", "card", "bank_transfer"]),
    reference: optionalString(120),
    note: optionalString(500)
  })
});

const bookingRefundSchema = z.object({
  body: z.object({
    reason: trimmedString({ min: 4, max: 500 })
  })
});

const manualBookingCreateSchema = z.object({
  body: z.object({
    tripId: objectIdLike,
    seats: seatArray,
    guest: z.object({
      name: trimmedString({ min: 2, max: 120 }),
      email: optionalString(120),
      phone: optionalString(40)
    }),
    paymentState: z.enum(["pending_payment", "paid"]).default("pending_payment"),
    paymentMethod: z.enum(["cash", "mobile_money", "card", "bank_transfer"]).optional(),
    paymentReference: optionalString(120),
    note: optionalString(500)
  })
});

const bookingLookupSchema = z.object({
  query: z.object({
    q: optionalString(120),
    tripId: objectIdLike.optional().or(z.literal("")),
    limit: coerceNumber({ min: 1, max: 50, integer: true }).optional()
  })
});

const bookingCheckInSchema = z.object({
  body: z.object({
    action: z.enum(["check_in", "mark_no_show"]),
    note: optionalString(500)
  })
});

const bookingSeatMoveSchema = z.object({
  body: z.object({
    fromSeatId: trimmedString({ min: 1, max: 20 }),
    toSeatId: trimmedString({ min: 1, max: 20 }),
    note: optionalString(500)
  })
});

const bookingCustomerNoteSchema = z.object({
  body: z.object({
    note: trimmedString({ min: 4, max: 500 })
  })
});

module.exports = {
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
  tripCreateSchema,
  tripUpdateSchema,
  routeCreateSchema,
  routeUpdateSchema,
  staffInviteCreateSchema,
  staffStatusSchema,
  supportCaseUpdateSchema,
  vehicleCreateSchema,
  vehicleUpdateSchema
};
