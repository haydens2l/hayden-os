export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startOpsSync } = await import("@/lib/ops/scheduler");
  startOpsSync();
}
