import { z } from "zod";

const UpStreamSchema = z.array(
  z.object({
    id: z.string(),
    strategy: z.string(),
    servers: z.array(z.string()),
  }),
);

const ServiceSchema = z.object({
  workers: z.int().optional(),
  listen: z.int(),
  upstreams: UpStreamSchema,
  headers: z.object().optional(),
  rules: z.array(
    z.object({
      path: z.string(),
      upstream: z.string(),
    }),
  ),
});

export const ConfigSchema = z.object({
  service: ServiceSchema,
});

export type ConfigSchemaTypes = z.infer<typeof ConfigSchema>;
