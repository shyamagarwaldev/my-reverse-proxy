import cluster, { Worker } from "node:cluster";
import os from "node:os";
import type { ConfigSchemaTypes } from "./config.schema";
import {
  WorkerMessageSchema,
  WorkerReplySchema,
  type WorkerMessageSchemaType,
  type WorkerReplyType,
} from "./server.schema";

// here header is not working as expected cuurently using to track the worker through index change im future !!

export async function createServer(config: ConfigSchemaTypes) {
  const { workers, listen } = config.service;
  if (cluster.isPrimary) {
    const worker_pool: Worker[] = [];
    const request_Pool = new Map<
      string,
      {
        resolve: (response: Response) => void;
        reject: (error: Error) => void;
      }
    >();
    const workerCount = workers ? workers : os.cpus().length;
    for (let i = 0; i < workerCount; i++) {
      const w = cluster.fork({ config: JSON.stringify(config) });
      w.on("message", async (reply) => {
        const validatedReply = await WorkerReplySchema.parseAsync(
          JSON.parse(reply),
        );
        const pending = request_Pool.get(validatedReply.reqId);
        if (!pending) {
          console.warn("No Pending Request");
          return;
        }
        const { resolve, reject } = pending;
        await new Promise((r) => setTimeout(r, 5000));
        if (validatedReply.errorCode) {
          resolve(
            new Response(validatedReply.error, {
              status: parseInt(validatedReply.errorCode),
            }),
          );
        } else {
          resolve(
            new Response(validatedReply.body, {
              status: validatedReply.status,
            }),
          );
        }
        // console.log("worker: ", validatedReply.headers);
        request_Pool.delete(validatedReply.reqId);
      });
      // w.on("exit", (code) => {}); //--> crach worker cleanup logic
      worker_pool.push(w);
      console.log(`Worker #${i + 1} Created By Master Process 🚀`);
    }
    const server = Bun.serve({
      port: listen,
      async fetch(req) {
        const index = Math.floor(Math.random() * worker_pool.length);
        const worker = worker_pool.at(index);
        if (!worker) throw new Error("No Worker Found ❌");
        const reqId = crypto.randomUUID();
        const message: WorkerMessageSchemaType = {
          reqId,
          url: req.url,
          // headers: Object.fromEntries(req.headers.entries()),
          headers: index,
          method: req.method,
          reqType: "http",
          body:
            req.method === "GET" || req.method === "HEAD"
              ? undefined
              : await req.text(),
        };
        const validatedWorkerMessage =
          await WorkerMessageSchema.parseAsync(message);
        return new Promise<Response>((resolve, reject) => {
          request_Pool.set(reqId, { resolve, reject });
          worker.send(JSON.stringify(validatedWorkerMessage));
        });
      },
    });
    console.log(`server is running ${server.port}`);
  } else {
    const config: ConfigSchemaTypes = JSON.parse(`${process.env.config}`);
    console.log("worker Process running 🏃‍♀️");
    process.on("message", async (msg: string) => {
      const validatedMessage = await WorkerMessageSchema.parseAsync(
        JSON.parse(msg),
      );
      const reqUrl = validatedMessage.url;
      const url = new URL(reqUrl);
      const pathname = url.pathname;
      const search = url.search;
      const rules = config.service.rules
        .filter((obj) => pathname.startsWith(obj.path))
        .sort((a, b) => b.path.length - a.path.length);
      if (rules.length === 0 || !rules[0]) {
        if (process.send) {
          const reply: WorkerReplyType = {
            reqId: validatedMessage.reqId,
            error: "Rule Not Found",
            errorCode: "404",
          };
          process.send(JSON.stringify(reply));
        }
        return;
      }
      const rule = rules[0];
      const upstream = config.service.upstreams.find(
        (upstream) => rule.upstream === upstream.id,
      );

      if (!upstream) {
        if (process.send) {
          const reply: WorkerReplyType = {
            reqId: validatedMessage.reqId,
            error: "No Upstream found",
            errorCode: "500",
          };
          process.send(JSON.stringify(reply));
        }
        return;
      }
      const server = upstream.servers[0];
      console.log(server + pathname + search);

      let reply: WorkerReplyType;
      try {
        const proxyResponse = await fetch(server + pathname + search, {
          method: validatedMessage.method,
          // headers: validatedMessage.headers,
          body:
            validatedMessage.method === "GET" ||
            validatedMessage.method === "HEAD"
              ? undefined
              : validatedMessage.body,
        });
        reply = {
          reqId: validatedMessage.reqId,
          // headers: Object.fromEntries(proxyResponse.headers.entries()),
          headers: validatedMessage.headers,
          status: proxyResponse.status,
          body: await proxyResponse.text(),
        };
      } catch (error) {
        reply = {
          reqId: validatedMessage.reqId,
          errorCode: "502",
          error: "Bad Gateway",
        };
      }
      if (process.send) {
        process.send(JSON.stringify(reply));
      }
      return;
    });
  }
}
