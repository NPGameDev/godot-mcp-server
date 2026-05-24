/**
 * Stateless test utilities for unit tests.
 * Pure factory functions — no shared mutable state between files.
 */

/**
 * Snapshot current process.env and return a restore function.
 * Use in tests that mutate env vars to guarantee cleanup.
 */
export function snapshotEnv(): () => void {
  const snapshot = { ...process.env };
  return () => {
    // Remove keys added during the test.
    for (const key of Object.keys(process.env)) {
      if (!(key in snapshot)) delete process.env[key];
    }
    // Restore original values.
    for (const [key, value] of Object.entries(snapshot)) {
      process.env[key] = value;
    }
  };
}

/**
 * Capture writes to process.stderr and return a function to retrieve them.
 * Restores the original stderr.write on cleanup.
 */
export function captureStderr(): { output: () => string; restore: () => void } {
  const chunks: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  }) as typeof process.stderr.write;
  return {
    output: () => chunks.join(""),
    restore: () => {
      process.stderr.write = original;
    },
  };
}
