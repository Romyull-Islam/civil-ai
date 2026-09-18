/**
 * Local AI manager: detects hardware, picks a model tier, downloads a llama.cpp server binary + GGUF model,
 * and runs an OpenAI-compatible server on localhost. Free, unlimited, offline. Node-only (never import from client code).
 */
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import net from "node:net";

export const LOCAL_PORT = Number(process.env.CIVIL_AI_LOCAL_PORT ?? 8765);
export const LOCAL_ENABLED = !process.env.VERCEL && process.env.CIVIL_AI_LOCAL_AI !== "0";

export interface ModelSpec { id: string; label: string; repo: string; file: string; sizeGB: number; minRamGB: number; params: string; note: string; vision?: boolean; /** never auto-selected; shown under "Advanced" */ advanced?: boolean; license: string }

/** Verified 17 Sept 2026 from huggingface.co (file sizes and licences from the HF API). All Apache-2.0 → free for commercial use; all support tool calling in llama.cpp with --jinja. */
export const MODEL_CATALOG: ModelSpec[] = [
  { id: "qwen3.5-0.8b", label: "Qwen 3.5 0.8B (tiny)", repo: "unsloth/Qwen3.5-0.8B-GGUF", file: "Qwen3.5-0.8B-Q4_K_M.gguf", sizeGB: 0.53, minRamGB: 3, params: "0.8B", note: "Runs anywhere; only for unit conversions and simple tool calls.", license: "Apache-2.0" },
  { id: "qwen3.5-2b", label: "Qwen 3.5 2B (light)", repo: "unsloth/Qwen3.5-2B-GGUF", file: "Qwen3.5-2B-Q4_K_M.gguf", sizeGB: 1.28, minRamGB: 5, params: "2B", note: "Good for 4–8 GB laptops; calculators and short answers.", license: "Apache-2.0" },
  { id: "qwen3.5-4b", label: "Qwen 3.5 4B (recommended)", repo: "unsloth/Qwen3.5-4B-GGUF", file: "Qwen3.5-4B-Q4_K_M.gguf", sizeGB: 2.74, minRamGB: 8, params: "4B", note: "Largest model the app installs by default: 2.7 GB, ~3 GB RAM in use, works on CPU-only laptops and 4 GB GPUs.", license: "Apache-2.0", vision: true },
  { id: "qwen3.5-9b", label: "Qwen 3.5 9B (advanced)", repo: "unsloth/Qwen3.5-9B-GGUF", file: "Qwen3.5-9B-Q4_K_M.gguf", sizeGB: 5.68, minRamGB: 14, params: "9B", note: "Better answers but slow on CPU-only PCs and needs an 8 GB GPU to be comfortable. Opt-in only.", license: "Apache-2.0", vision: true, advanced: true },
  { id: "gemma4-e2b", label: "Gemma 4 E2B (light, vision)", repo: "unsloth/gemma-4-E2B-it-GGUF", file: "gemma-4-E2B-it-Q4_K_M.gguf", sizeGB: 3.11, minRamGB: 8, params: "2B eff.", note: "Google's small model with image input and tool calling.", license: "Apache-2.0", vision: true },
  { id: "qwen3.5-35b-a3b", label: "Qwen 3.5 35B-A3B (MoE, desktop)", repo: "unsloth/Qwen3.5-35B-A3B-GGUF", file: "Qwen3.5-35B-A3B-Q4_K_M.gguf", sizeGB: 21.5, minRamGB: 28, params: "35B (3B active)", note: "Near-cloud quality at CPU speed of a 3B model; needs 32 GB RAM and a 22 GB download. Opt-in only.", license: "Apache-2.0", vision: true, advanced: true },
];

export interface Hardware { platform: NodeJS.Platform; arch: string; cpuModel: string; cores: number; ramGB: number; gpu: { vendor: "nvidia" | "amd" | "apple" | "intel" | "none"; name?: string; vramGB?: number } }

function gpuFromNvidiaSmi(): Hardware["gpu"] | null {
  try {
    const out = execFileSync("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"], { timeout: 4000, stdio: ["ignore", "pipe", "ignore"] }).toString().trim().split("\n")[0];
    if (out) { const [name, mem] = out.split(",").map((x) => x.trim()); return { vendor: "nvidia", name, vramGB: Math.round(Number(mem) / 1024) }; }
  } catch { /* no nvidia-smi or driver problem */ }
  return null;
}

function gpuFromLinuxSysfs(): Hardware["gpu"] | null {
  // /sys/class/drm/card*/device/{vendor,mem_info_vram_total} — works for AMD (0x1002), Intel (0x8086), NVIDIA (0x10de, no VRAM file)
  try {
    const cards = fs.readdirSync("/sys/class/drm").filter((c) => /^card\d+$/.test(c));
    const found: Hardware["gpu"][] = [];
    for (const c of cards) {
      const dev = `/sys/class/drm/${c}/device`;
      let vendorId = ""; try { vendorId = fs.readFileSync(`${dev}/vendor`, "utf8").trim(); } catch { continue; }
      const vendor: Hardware["gpu"]["vendor"] = vendorId === "0x10de" ? "nvidia" : vendorId === "0x1002" ? "amd" : vendorId === "0x8086" ? "intel" : "none";
      if (vendor === "none") continue;
      let vramGB: number | undefined; try { vramGB = Math.round(Number(fs.readFileSync(`${dev}/mem_info_vram_total`, "utf8").trim()) / 1e9); } catch { /* n/a */ }
      found.push({ vendor, name: `${vendor.toUpperCase()} GPU (${c})`, vramGB });
    }
    // Prefer discrete cards with the most VRAM.
    found.sort((a, b) => (b.vramGB ?? 0) - (a.vramGB ?? 0) || (a.vendor === "intel" ? 1 : 0) - (b.vendor === "intel" ? 1 : 0));
    return found[0] ?? null;
  } catch { return null; }
}

function gpuFromLspci(): Hardware["gpu"] | null {
  try {
    const lspci = execFileSync("lspci", [], { timeout: 4000, stdio: ["ignore", "pipe", "ignore"] }).toString();
    const lines = lspci.split("\n").filter((l) => /VGA compatible controller|3D controller|Display controller/i.test(l)).map((l) => l.split(":").slice(2).join(":").trim());
    const pick = lines.find((n) => /\bNVIDIA\b/i.test(n)) ?? lines.find((n) => /\b(AMD|ATI|Radeon)\b/i.test(n)) ?? lines.find((n) => /\bIntel\b/i.test(n));
    if (pick) return { vendor: /\bNVIDIA\b/i.test(pick) ? "nvidia" : /\b(AMD|ATI|Radeon)\b/i.test(pick) ? "amd" : "intel", name: pick };
  } catch { /* ignore */ }
  return null;
}

function gpuFromWindows(): Hardware["gpu"] | null {
  // Registry qwMemorySize is 64-bit (AdapterRAM from WMI is capped at 4 GB).
  const script = `$r = Get-ItemProperty -Path 'HKLM:\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' -ErrorAction SilentlyContinue | Where-Object { $_.DriverDesc } | Select-Object DriverDesc, @{n='vram';e={ if ($_.'HardwareInformation.qwMemorySize') { [int64]$_.'HardwareInformation.qwMemorySize' } else { [int64]$_.'HardwareInformation.MemorySize' } }}; $r | ConvertTo-Json -Compress`;
  try {
    const out = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 8000, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    if (!out) return null;
    const parsed = JSON.parse(out) as { DriverDesc: string; vram: number } | { DriverDesc: string; vram: number }[];
    const list = (Array.isArray(parsed) ? parsed : [parsed]).map((g) => ({ name: g.DriverDesc, vramGB: g.vram ? Math.round(g.vram / 1e9) : undefined, vendor: (/NVIDIA|GeForce|RTX|Quadro/i.test(g.DriverDesc) ? "nvidia" : /AMD|Radeon/i.test(g.DriverDesc) ? "amd" : /Intel/i.test(g.DriverDesc) ? "intel" : "none") as Hardware["gpu"]["vendor"] })).filter((g) => g.vendor !== "none");
    list.sort((a, b) => (b.vramGB ?? 0) - (a.vramGB ?? 0));
    return list[0] ?? null;
  } catch { return null; }
}

export function detectHardware(): Hardware {
  const ramGB = Math.round(os.totalmem() / 1e9);
  const cpus = os.cpus();
  let gpu: Hardware["gpu"] | null = null;
  if (process.platform === "darwin") gpu = process.arch === "arm64" ? { vendor: "apple", name: "Apple Silicon (unified memory)", vramGB: ramGB } : null;
  else if (process.platform === "win32") gpu = gpuFromNvidiaSmi() ?? gpuFromWindows();
  else {
    const smi = gpuFromNvidiaSmi();
    const sys = gpuFromLinuxSysfs();
    gpu = smi ?? (sys && (sys.vramGB || sys.vendor !== "nvidia") ? sys : null) ?? gpuFromLspci() ?? sys;
  }
  return { platform: process.platform, arch: process.arch, cpuModel: cpus[0]?.model ?? "unknown", cores: cpus.length, ramGB, gpu: gpu ?? { vendor: "none" } };
}

/**
 * Pick the default model from the detected configuration.
 *  - strong discrete GPU (≥ 12 GB VRAM) and ≥ 16 GB RAM → Qwen 3.5 9B (fast on that hardware)
 *  - everything else with ≥ 8 GB RAM (no GPU, or 4–8 GB GPU) → Qwen 3.5 4B — the cap for ordinary PCs
 *  - 5–8 GB RAM → 2B; below → 0.8B
 * Larger models are opt-in from the "Advanced" list.
 */
export function recommendModel(hw: Hardware): ModelSpec {
  const vram = hw.gpu.vendor === "apple" ? Math.round(hw.ramGB * 0.65) : hw.gpu.vramGB ?? 0;
  const strongGpu = (hw.gpu.vendor === "nvidia" || hw.gpu.vendor === "amd" || hw.gpu.vendor === "apple") && vram >= 12;
  const id = strongGpu && hw.ramGB >= 16 ? "qwen3.5-9b" : hw.ramGB >= 8 ? "qwen3.5-4b" : hw.ramGB >= 5 ? "qwen3.5-2b" : "qwen3.5-0.8b";
  return MODEL_CATALOG.find((m) => m.id === id) ?? MODEL_CATALOG[0];
}

// ---------- paths & state ----------
export function dataDir(): string {
  const d = process.env.CIVIL_AI_USER_DATA || path.join(os.homedir(), ".civil-ai");
  fs.mkdirSync(path.join(d, "models"), { recursive: true });
  fs.mkdirSync(path.join(d, "bin"), { recursive: true });
  return d;
}

interface State { modelId?: string; binaryTag?: string; gpuBuild?: boolean; serverPid?: number }
const stateFile = () => path.join(dataDir(), "local-ai.json");
export function readState(): State { try { return JSON.parse(fs.readFileSync(stateFile(), "utf8")) as State; } catch { return {}; } }
function writeState(s: State) { fs.writeFileSync(stateFile(), JSON.stringify(s, null, 2)); }

// ---------- llama.cpp binary ----------
/** Release of ggml-org/llama.cpp with prebuilt binaries (verified 17 Sept 2026). Update LLAMA_TAG to move forward. */
export const LLAMA_TAG = process.env.CIVIL_AI_LLAMA_TAG ?? "b11026";

export function binaryAsset(hw: Hardware, gpuBuild: boolean): { asset: string; exe: string } | null {
  // Vulkan builds (~30 MB) accelerate NVIDIA, AMD and Intel GPUs without the 400 MB CUDA runtime; macOS uses Metal in the default build.
  const base = `llama-${LLAMA_TAG}-bin-`;
  const gpu = gpuBuild && hw.gpu.vendor !== "none";
  if (hw.platform === "win32") {
    if (hw.arch === "arm64") return { asset: `${base}win-cpu-arm64.zip`, exe: "llama-server.exe" };
    return { asset: gpu ? `${base}win-vulkan-x64.zip` : `${base}win-cpu-x64.zip`, exe: "llama-server.exe" };
  }
  if (hw.platform === "darwin") return { asset: hw.arch === "arm64" ? `${base}macos-arm64.tar.gz` : `${base}macos-x64.tar.gz`, exe: "llama-server" };
  if (hw.platform === "linux") {
    if (hw.arch === "arm64") return { asset: gpu ? `${base}ubuntu-vulkan-arm64.tar.gz` : `${base}ubuntu-arm64.tar.gz`, exe: "llama-server" };
    return { asset: gpu ? `${base}ubuntu-vulkan-x64.tar.gz` : `${base}ubuntu-x64.tar.gz`, exe: "llama-server" };
  }
  return null;
}

const binDir = () => path.join(dataDir(), "bin");

/** Ask the downloaded engine which compute devices it sees; true only if a discrete NVIDIA/AMD GPU is listed. */
export function gpuBuildUsable(hw: Hardware): boolean {
  const exe = serverExe(hw);
  if (!exe) return false;
  try {
    const out = execFileSync(/* turbopackIgnore: true */ exe, ["--list-devices"], { timeout: 20000, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LD_LIBRARY_PATH: path.dirname(exe) } }).toString();
    return /NVIDIA|GeForce|RTX|Quadro|AMD|Radeon/i.test(out);
  } catch { return false; }
}
export function serverExe(hw = detectHardware()): string | null {
  const exe = hw.platform === "win32" ? "llama-server.exe" : "llama-server";
  const stack = [binDir()];
  while (stack.length) {
    const d = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name === exe) return p;
    }
  }
  return null;
}

// ---------- downloads ----------
export interface Progress { phase: "idle" | "binary" | "model" | "extract" | "done" | "error"; file?: string; received: number; total: number; message?: string }
let progress: Progress = { phase: "idle", received: 0, total: 0 };
let abort: AbortController | null = null;
export const getProgress = () => progress;
export function cancelSetup() { abort?.abort(); }

async function download(url: string, dest: string, phase: Progress["phase"], signal: AbortSignal) {
  const tmp = dest + ".part";
  let start = 0;
  try { start = fs.statSync(tmp).size; } catch { /* none */ }
  const res = await fetch(url, { headers: start ? { Range: `bytes=${start}-` } : {}, signal, redirect: "follow" });
  if (!res.ok && res.status !== 206) throw new Error(`Download failed ${res.status} for ${url}`);
  if (res.status !== 206) start = 0;
  const total = start + Number(res.headers.get("content-length") ?? 0);
  progress = { phase, file: path.basename(dest), received: start, total };
  const out = fs.createWriteStream(tmp, { flags: start ? "a" : "w" });
  let received = start;
  const counter = new (await import("node:stream")).Transform({ transform(chunk, _e, cb) { received += chunk.length; progress = { ...progress, received }; cb(null, chunk); } });
  await pipeline(Readable.fromWeb(res.body as never), counter, out);
  fs.renameSync(tmp, dest);
}

async function extract(archive: string, into: string) {
  progress = { ...progress, phase: "extract", message: `Extracting ${path.basename(archive)}` };
  fs.mkdirSync(into, { recursive: true });
  if (archive.endsWith(".zip")) {
    if (process.platform === "win32") execFileSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -Force -Path '${archive}' -DestinationPath '${into}'`], { stdio: "ignore" });
    else execFileSync("unzip", ["-o", "-q", archive, "-d", into], { stdio: "ignore" });
  } else {
    execFileSync("tar", ["-xzf", archive, "-C", into], { stdio: "ignore" });
  }
  fs.rmSync(archive, { force: true });
  if (process.platform !== "win32") { const exe = serverExe(); if (exe) fs.chmodSync(exe, 0o755); }
}

export const modelPath = (m: ModelSpec) => path.join(dataDir(), "models", m.file);
export const isModelInstalled = (m: ModelSpec) => fs.existsSync(modelPath(m));

/** Download binary (if missing) and model (if missing), then start the server. */
export async function setup(opts: { modelId?: string; gpuBuild?: boolean } = {}): Promise<void> {
  if (!LOCAL_ENABLED) throw new Error("Local AI is disabled on this deployment.");
  if (abort && progress.phase !== "done" && progress.phase !== "error" && progress.phase !== "idle") throw new Error("Setup already running");
  abort = new AbortController();
  const signal = abort.signal;
  const hw = detectHardware();
  const model = MODEL_CATALOG.find((m) => m.id === opts.modelId) ?? recommendModel(hw);
  // GPU build by default for NVIDIA anywhere and for AMD/Intel on Windows (Vulkan runtime ships with the driver); CPU build elsewhere, with automatic fallback.
  // Measured: an Intel iGPU through Vulkan is slower than the CPU for prompt processing, so only discrete NVIDIA/AMD cards (and Apple Metal) get the GPU build.
  let gpuBuild = opts.gpuBuild ?? (hw.gpu.vendor === "apple" || ((hw.gpu.vendor === "nvidia" || hw.gpu.vendor === "amd") && (hw.gpu.vramGB === undefined || hw.gpu.vramGB >= 4)));
  try {
    const state = readState();
    let binaryChanged = false;
    if (!serverExe(hw) || state.binaryTag !== LLAMA_TAG || state.gpuBuild !== gpuBuild) {
      binaryChanged = true;
      stopServer();
      const asset = binaryAsset(hw, gpuBuild);
      if (!asset) throw new Error(`No prebuilt llama.cpp binary for ${hw.platform}/${hw.arch}`);
      fs.rmSync(binDir(), { recursive: true, force: true });
      fs.mkdirSync(binDir(), { recursive: true });
      const archive = path.join(dataDir(), asset.asset);
      await download(`https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}/${asset.asset}`, archive, "binary", signal);
      await extract(archive, binDir());
      if (!serverExe(hw)) throw new Error("llama-server not found after extraction");
      // Sanity check: the GPU build must actually see a discrete GPU (a broken driver or an Intel iGPU only would make it slower than the CPU build).
      if (gpuBuild && hw.platform !== "darwin" && !gpuBuildUsable(hw)) {
        progress = { phase: "binary", received: 0, total: 0, message: "GPU not usable by the engine; switching to CPU build" };
        gpuBuild = false;
        const cpu = binaryAsset(hw, false)!;
        fs.rmSync(binDir(), { recursive: true, force: true }); fs.mkdirSync(binDir(), { recursive: true });
        const cpuArchive = path.join(dataDir(), cpu.asset);
        await download(`https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}/${cpu.asset}`, cpuArchive, "binary", signal);
        await extract(cpuArchive, binDir());
      }
      writeState({ ...state, binaryTag: LLAMA_TAG, gpuBuild });
    }
    if (!isModelInstalled(model)) {
      await download(`https://huggingface.co/${model.repo}/resolve/main/${model.file}`, modelPath(model), "model", signal);
    }
    writeState({ ...readState(), modelId: model.id });
    progress = { phase: "done", received: 0, total: 0, message: `${model.label} installed` };
    try {
      if (binaryChanged) { const pid = readState().serverPid; if (pid) await killPid(pid); }
      await startServer(model);
    } catch (e) {
      if (!gpuBuild) throw e;
      // GPU build failed (missing Vulkan driver etc.) → fetch the CPU build and retry once.
      progress = { phase: "binary", received: 0, total: 0, message: "GPU build failed to start; switching to CPU build" };
      stopServer();
      const asset = binaryAsset(hw, false)!;
      fs.rmSync(binDir(), { recursive: true, force: true }); fs.mkdirSync(binDir(), { recursive: true });
      const archive = path.join(dataDir(), asset.asset);
      await download(`https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}/${asset.asset}`, archive, "binary", signal);
      await extract(archive, binDir());
      writeState({ ...readState(), binaryTag: LLAMA_TAG, gpuBuild: false });
      progress = { phase: "done", received: 0, total: 0, message: `${model.label} installed (CPU build)` };
      await startServer(model);
    }
  } catch (e) {
    progress = { phase: "error", received: 0, total: 0, message: e instanceof Error ? e.message : String(e) };
    throw e;
  } finally { abort = null; }
}

// ---------- server lifecycle ----------
let proc: ChildProcess | null = null;
let running: { modelId: string; pid: number; startedAt: number } | null = null;
let lastLog: string[] = [];

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => { const s = net.createConnection({ port, host: "127.0.0.1" }); s.once("connect", () => { s.end(); resolve(true); }); s.once("error", () => resolve(false)); });
}

async function servedModelId(): Promise<string | null> {
  try { const r = await fetch(`http://127.0.0.1:${LOCAL_PORT}/v1/models`); const j = (await r.json()) as { data?: { id: string }[] }; return j.data?.[0]?.id ?? null; } catch { return null; }
}

async function killPid(pid: number) {
  try { process.kill(pid); } catch { return; }
  for (let i = 0; i < 50; i++) { if (!(await portOpen(LOCAL_PORT))) return; await new Promise((r) => setTimeout(r, 200)); }
  try { process.kill(pid, "SIGKILL"); } catch { /* gone */ }
}

export async function startServer(model?: ModelSpec): Promise<void> {
  const hw = detectHardware();
  const exe = serverExe(hw);
  const m = model ?? MODEL_CATALOG.find((x) => x.id === readState().modelId);
  if (!exe || !m || !isModelInstalled(m)) throw new Error("Local model not installed yet");
  if (await portOpen(LOCAL_PORT)) {
    const served = await servedModelId();
    if (served === m.id) { running = running ?? { modelId: m.id, pid: readState().serverPid ?? 0, startedAt: Date.now() }; return; }
    // A different model (or a stale engine from a previous session) owns the port: replace it.
    const pid = proc?.pid ?? readState().serverPid;
    if (proc) { proc.kill(); proc = null; }
    if (pid) await killPid(pid);
    if (await portOpen(LOCAL_PORT)) throw new Error(`Port ${LOCAL_PORT} is in use by another program (serving "${served ?? "unknown"}"). Set CIVIL_AI_LOCAL_PORT to a free port.`);
  }
  const threads = Math.max(2, Math.min(hw.cores - 2, 16));
  const args = ["-m", modelPath(m), "--host", "127.0.0.1", "--port", String(LOCAL_PORT), "-c", "16384", "-t", String(threads), "--jinja", "-ngl", readState().gpuBuild ? "999" : "0", "--alias", m.id, "--no-webui",
    // Speed on CPU: skip hidden "thinking" tokens (the app's tools do the reasoning) and reuse the KV cache across turns that share the system prompt + tool schemas.
    "--reasoning-budget", "0", "--cache-reuse", "256"];
  lastLog = [];
  proc = spawn(/* turbopackIgnore: true */ exe, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LD_LIBRARY_PATH: path.dirname(exe) } });
  const log = (d: Buffer) => { lastLog.push(d.toString()); if (lastLog.length > 50) lastLog.shift(); };
  proc.stdout?.on("data", log); proc.stderr?.on("data", log);
  proc.on("exit", () => { running = null; proc = null; });
  running = { modelId: m.id, pid: proc.pid ?? 0, startedAt: Date.now() };
  writeState({ ...readState(), modelId: m.id, serverPid: proc.pid });
  for (let i = 0; i < 120; i++) {
    if (await portOpen(LOCAL_PORT)) {
      try { const r = await fetch(`http://127.0.0.1:${LOCAL_PORT}/health`); if (r.ok) return; } catch { /* not yet */ }
    }
    if (!proc) throw new Error(`llama-server exited: ${lastLog.slice(-5).join("")}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("llama-server did not become healthy in time");
}

export function stopServer() { const pid = proc?.pid ?? readState().serverPid; if (proc) { proc.kill(); proc = null; } else if (pid) { try { process.kill(pid); } catch { /* gone */ } } running = null; }

export async function status() {
  const hw = detectHardware();
  const state = readState();
  const installed = MODEL_CATALOG.filter(isModelInstalled).map((m) => m.id);
  const healthy = await portOpen(LOCAL_PORT);
  return {
    enabled: LOCAL_ENABLED,
    hardware: hw,
    recommended: recommendModel(hw).id,
    catalog: MODEL_CATALOG.map((m) => ({ ...m, installed: installed.includes(m.id), fits: m.minRamGB <= hw.ramGB })),
    binaryInstalled: !!serverExe(hw),
    binaryTag: state.binaryTag,
    activeModel: state.modelId,
    running: healthy ? { ...(running ?? { modelId: (await servedModelId()) ?? state.modelId, pid: state.serverPid ?? 0, startedAt: 0 }), port: LOCAL_PORT } : null,
    progress,
    log: lastLog.slice(-8).join(""),
  };
}
