import {
  WORKFLOW_PROMPT,
  createWorkflowRuntime,
  runTestWorkflow,
} from "./workflow.js";

async function main() {
  const agent = process.argv[2]; // опционально: bun index.js refactor
  const runtime = await createWorkflowRuntime();
  try {
    console.log(`> ${WORKFLOW_PROMPT}${agent ? ` [agent: ${agent}]` : ""}`);
    const { sessionId, agent: usedAgent, response } = await runTestWorkflow(
      runtime.client,
      { agent }
    );
    console.log(`Session: ${sessionId} (agent: ${usedAgent})`);
    console.log(`< ${response}`);
  } finally {
    await runtime.close();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
