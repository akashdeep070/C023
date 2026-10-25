// Small helpers shared by the route modules.

import type { Request } from "express";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** A numeric route parameter, or a 404. */
export function id(req: Request, key = "id"): number {
  const n = Number(req.params[key]);
  if (!Number.isInteger(n)) throw new HttpError(404, "Not found");
  return n;
}

export const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
