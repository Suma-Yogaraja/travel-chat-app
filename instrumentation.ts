import { registerOTel } from "@vercel/otel";
import { LangfuseExporter } from "langfuse-vercel";

export function register() {
  console.log("[instrumentation] register() called, LANGFUSE_PUBLIC_KEY set:", !!process.env.LANGFUSE_PUBLIC_KEY);
  registerOTel({
    serviceName: "travel-chat-app",
    traceExporter: new LangfuseExporter({ debug: true }),
  });
  console.log("[instrumentation] OTel registered with LangfuseExporter");
}
