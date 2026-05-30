import { z } from "zod";

export const WorkerMessageSchema = z.object({
  reqId: z.uuid(),
  reqType: z.enum(["http"]),
  body: z.string().optional(),
  method: z.string(),
  url: z.string(),
  headers: z.any().optional(),
});

export const WorkerReplySchema = z.object({
  reqId: z.uuid(),
  error: z.string().optional(),
  errorCode: z.enum(["404", "500", "502"]).optional(),
  body: z.string().optional(),
  headers: z.any().optional(),
  status: z.int().optional(),
});

export type WorkerMessageSchemaType = z.infer<typeof WorkerMessageSchema>;
export type WorkerReplyType = z.infer<typeof WorkerReplySchema>;
