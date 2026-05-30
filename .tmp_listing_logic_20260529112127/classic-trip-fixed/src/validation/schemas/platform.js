const {
  z,
  trimmedString,
  optionalString,
  objectIdLike
} = require("./helpers");

const partnerInviteCreateSchema = z.object({
  body: z.object({
    inquiryId: objectIdLike.optional().or(z.literal("")),
    companyName: trimmedString({ min: 2, max: 120 }),
    businessType: trimmedString({ min: 2, max: 80 }),
    country: trimmedString({ min: 2, max: 80 }),
    contactName: trimmedString({ min: 2, max: 80 }),
    email: z.string().trim().email(),
    phone: optionalString(40),
    notes: optionalString(1200),
    role: z.enum(["company_admin", "partner"]).default("company_admin")
  })
});

const partnerInquiryReviewSchema = z.object({
  body: z.object({
    status: z.enum(["new", "reviewing", "rejected"]),
    notes: optionalString(1200)
  })
});

const partnerStatusSchema = z.object({
  body: z.object({
    status: z.enum(["active", "suspended"])
  })
});

const myProfileSchema = z.object({
  body: z.object({
    name: trimmedString({ min: 2, max: 120 }),
    phone: optionalString(40),
    jobTitle: optionalString(80),
    permissionsLabel: optionalString(160)
  })
});

module.exports = {
  myProfileSchema,
  partnerInviteCreateSchema,
  partnerInquiryReviewSchema,
  partnerStatusSchema
};
