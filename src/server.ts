import cluster from "node:cluster";
import os from "node:os";
import type { ConfigSchemaTypes } from "./config.schema";

// here header is not working as expected cuurently using to track the worker through index change im future !!

function spawnWorker(
  config: ConfigSchemaTypes,
  upstream_pointer: Map<string, number>,
) {
  const worker = cluster.fork({
    config: JSON.stringify(config),
    upstream_pointer: JSON.stringify(Array.from(upstream_pointer.entries())),
  });

  worker.on("exit", () => {
    console.log(`Worker ${worker.process.pid} died`);
    setTimeout(() => {
      spawnWorker(config, upstream_pointer);
    }, 1000);
  });

  return worker;
}

export async function createServer(config: ConfigSchemaTypes) {
  if (cluster.isPrimary) {
    const upstream_pointer = new Map();
    const { workers, upstreams, rules } = config.service;
    const sortedRuels = rules.sort((a, b) => b.path.length - a.path.length);
    config.service.rules = sortedRuels;
    upstreams.forEach((upstream) => {
      upstream_pointer.set(upstream.id, 0);
    });
    const workerCount = workers ? workers : os.cpus().length;
    for (let i = 0; i < workerCount; i++) {
      spawnWorker(config, upstream_pointer);
    }
  } else {
    const config: ConfigSchemaTypes = JSON.parse(`${process.env.config}`);
    const upstream_pointer: Map<string, number> = new Map(
      JSON.parse(`${process.env.upstream_pointer}`),
    );
    const server = Bun.serve({
      port: config.service.listen,
      async fetch(req) {
        const reqUrl = req.url;
        const url = new URL(reqUrl);
        const pathname = url.pathname;
        const search = url.search;
        const rule = config.service.rules.find((obj) =>
          pathname.startsWith(obj.path),
        );
        if (!rule) {
          return new Response("Rule Not Found", {
            status: 404,
          });
        }
        const upstream = config.service.upstreams.find(
          (upstream) => rule.upstream === upstream.id,
        );

        if (!upstream) {
          return new Response("No Upstream found", {
            status: 500,
          });
        }
        let server;
        if (upstream.strategy == "round-robin") {
          let index = upstream_pointer.get(upstream.id)!;
          server = upstream.servers[index];
          upstream_pointer.set(
            upstream.id,
            (index + 1) % upstream.servers.length,
          );
        } else {
          server = upstream.servers[0];
        }
        if (!server) {
          return new Response("No upstream server available", { status: 503 });
        }
        console.log(server + pathname + search);
        const headers = req.headers.toJSON();
        console.log(headers.host, "  ", headers.connection);

        delete headers.host;
        delete headers.connection;
        const controller = new AbortController();
        const signal = controller.signal;
        const abort = setTimeout(() => {
          controller.abort();
        }, 30000);
        try {
          const proxyResponse = await fetch(server + pathname + search, {
            method: req.method,
            headers,
            body: req.body,
            signal,
          });
          return new Response(await proxyResponse.text(), {
            status: proxyResponse.status,
          });
        } catch (error) {
          if (signal.aborted) {
            return new Response("Gateway Timeout", {
              status: 504,
            });
          }
          console.log(req.headers.toJSON());
          return new Response("Bad Gateway", {
            status: 502,
          });
        } finally {
          clearTimeout(abort);
        }
      },
    });
    console.log("worker Process running 🏃‍♀️");
  }
}
