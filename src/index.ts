import { runCliPlanner } from "./interfaces/cli/run-plan.js";
import { startApiServer } from "./interfaces/api/server.js";

const isCli = process.argv.includes("--cli");

if (isCli) {
  await runCliPlanner();
} else {
  await startApiServer();
}
