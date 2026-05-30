const { z, optionalString } = require("./helpers");

const registerSchema = z.object({
  body: z
    .object({
      name: optionalString(80),
      firstName: optionalString(80),
      lastName: optionalString(80),
      email: z.string().trim().email(),
      password: z.string().min(8).max(128),
      phone: optionalString(40),
      role: z.enum(["customer", "promoter", "partner", "company_admin", "employee", "company_employee"]).default("customer"),
      companyEmail: optionalString(120),
      company: optionalString(120),
      businessType: optionalString(80),
      country: optionalString(80)
    })
    .refine(
      (body) => Boolean(String(body.name || `${body.firstName || ""} ${body.lastName || ""}`).trim()),
      "Name is required."
    )
});

const inviteAcceptSchema = z.object({
  body: z
    .object({
      name: optionalString(80),
      firstName: optionalString(80),
      lastName: optionalString(80),
      phone: optionalString(40),
      password: z.string().min(8).max(128),
      company: optionalString(120),
      businessType: optionalString(80),
      country: optionalString(80)
    })
    .refine(
      (body) => Boolean(String(body.name || `${body.firstName || ""} ${body.lastName || ""}`).trim()),
      "Name is required."
    )
});

const loginSchema = z.object({
  body: z
    .object({
      email: optionalString(120),
      identity: optionalString(120),
      password: z.string().min(1).max(128)
    })
    .refine(
      (body) => Boolean(String(body.email || body.identity || "").trim()),
      "Email or phone is required."
    )
});

module.exports = {
  registerSchema,
  loginSchema,
  inviteAcceptSchema
};
