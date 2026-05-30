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
const hostnameLike = trimmedString({ min: 3, max: 253 }).transform((value) => value.toLowerCase());

module.exports = {
  z,
  trimmedString,
  optionalString,
  coerceNumber,
  coerceBoolean,
  seatArray,
  objectIdLike,
  currencyCode,
  hostnameLike
};
