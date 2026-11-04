import { LangfuseSpanProcessor } from "@langfuse/otel";

// Singleton span processor shared between instrumentation.ts (registers it with the
// OTel SDK) and the chat route (calls forceFlush after each serverless request).
export const langfuseProcessor = new LangfuseSpanProcessor({
  exportMode: "immediate",
});
