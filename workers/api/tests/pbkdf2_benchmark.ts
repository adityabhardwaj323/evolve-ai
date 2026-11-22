/**
 * PBKDF2 Performance and CPU Consumption Benchmark Script
 * Tests 100,000, 310,000 (OWASP recommended for PBKDF2-HMAC-SHA256), and 600,000 iterations
 * using Web Crypto API.
 */

async function benchmarkPBKDF2(iterations: number, runs: number = 5): Promise<{ iterations: number; avgMs: number; minMs: number; maxMs: number }> {
  const enc = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    enc.encode('StandardPassword123!@#NormalizedTestString'),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const times: number[] = [];

  for (let i = 0; i < runs; i++) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const start = performance.now();
    await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations,
        hash: 'SHA-256',
      },
      passwordKey,
      256
    );
    const end = performance.now();
    times.push(end - start);
  }

  const avgMs = times.reduce((a, b) => a + b, 0) / times.length;
  const minMs = Math.min(...times);
  const maxMs = Math.max(...times);

  return { iterations, avgMs, minMs, maxMs };
}

async function run() {
  console.log('--- Benchmarking PBKDF2-HMAC-SHA256 Configurations ---');
  const configs = [100000, 310000, 600000];

  for (const iter of configs) {
    const res = await benchmarkPBKDF2(iter, 5);
    console.log(
      `Iterations: ${res.iterations.toLocaleString().padStart(8)} | Avg: ${res.avgMs.toFixed(2).padStart(6)} ms | Min: ${res.minMs.toFixed(2).padStart(6)} ms | Max: ${res.maxMs.toFixed(2).padStart(6)} ms`
    );
  }
}

run().catch(console.error);
