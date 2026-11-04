import { registerOTel } from "@vercel/otel";
import { registerTelemetry } from "ai";
import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk";
import { langfuseProcessor } from "./lib/langfuse-processor";

export function register() {
  registerOTel({
    serviceName: "travel-chat-app",
    spanProcessors: [langfuseProcessor],
  });
  registerTelemetry(new LangfuseVercelAiSdkIntegration());
}
