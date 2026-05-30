import { parse } from "yaml";
import { program } from "commander";
import { ConfigSchema } from "./config.schema";
import { createServer } from "./server";
async function parseConfig(filepath: string) {
  const config = Bun.file(filepath);
  const parsedConfig = parse(await config.text());
  return await ConfigSchema.parseAsync(parsedConfig);
}

async function main() {
  program.option("--config <char>");
  program.parse();
  const option = program.opts();
  if (option && "config" in option) {
    const path = option.config;
    const config = await parseConfig(path);
    await createServer(config);
  }
}

main();
