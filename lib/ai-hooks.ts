// Logging hooks for streamText — passed to onStepFinish and onFinish callbacks.
// AI SDK v7: tool calls are on step.dynamicToolCalls (for MCP tools without static types)

import { logger } from "./logger";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createLoggingHook(): (step: any) => void {
  return (step) => {
    const toolCalls = [...(step.toolCalls ?? []), ...(step.dynamicToolCalls ?? [])];
    toolCalls.forEach((tc: { toolName: string; input?: unknown; args?: unknown }) => {
      logger.info("tool_called", { tool: tc.toolName });
    });
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createTokenCountHook(): (event: any) => void {
  return (event) => {
    if (event?.usage) {
      logger.info("tokens", { in: event.usage.inputTokens, out: event.usage.outputTokens });
    }
  };
}
