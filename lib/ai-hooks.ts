// Logging hooks for streamText — passed to onStepFinish and onFinish callbacks.
// AI SDK v7: tool calls are on step.dynamicToolCalls (for MCP tools without static types)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createLoggingHook(): (step: any) => void {
  return (step) => {
    const toolCalls = [...(step.toolCalls ?? []), ...(step.dynamicToolCalls ?? [])];
    if (toolCalls.length > 0) {
      toolCalls.forEach((tc: { toolName: string; input?: unknown; args?: unknown }) => {
        console.log(`\n[TOOL CALLED] ${tc.toolName}`);
        console.log("  Input:", JSON.stringify(tc.input ?? tc.args, null, 2));
      });
    }
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createTokenCountHook(): (event: any) => void {
  return (event) => {
    if (event?.usage) {
      console.log(
        `\n[TOKENS] prompt: ${event.usage.promptTokens}, completion: ${event.usage.completionTokens}`
      );
    }
  };
}
