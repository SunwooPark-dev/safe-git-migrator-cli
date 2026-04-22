#!/usr/bin/env node
const { runCli } = require("./lib/runner");

runCli(process.argv.slice(2)).catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
