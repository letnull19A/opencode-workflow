import { OpencodeAgentExecutor, WORKFLOW_PROMPT } from "../impl/OpencodeAgentExecutor.ts";

/** CLI: прогон одного агента. `bun src/cli/index.ts [agent]`. */
async function main(): Promise<void> {
  const agent = process.argv[2];
  const executor = await OpencodeAgentExecutor.create();
  try {
    console.log(`> ${WORKFLOW_PROMPT}${agent ? ` [agent: ${agent}]` : ""}`);
    const { sessionId, text } = await executor.runSession({
      prompt: WORKFLOW_PROMPT,
      ...(agent ? { agent } : {}),
    });
    console.log(`Session: ${sessionId} (agent: ${agent ?? "build"})`);
    console.log(`< ${text}`);
  } finally {
    await executor.close();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);