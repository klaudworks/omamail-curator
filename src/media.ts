import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { checked } from "./io.ts"

export function mediaType(data: Buffer) {
  if (data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "png"
  if (data.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))) return "jpg"
  if (["GIF87a", "GIF89a"].includes(data.subarray(0, 6).toString())) return "gif"
  if (data.subarray(4, 8).toString() === "ftyp") return "mp4"
  throw new Error("Unsupported attachment type")
}

// Only descriptions/comments containing this attachment supply timestamps.
export function recordingSamples(duration: number, texts: string[]) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 86400) throw new Error("Recording duration unavailable or outside the one-day ingestion limit")
  const last = Math.max(0, Math.ceil(duration * 4) - 1), requested = new Set<number>()
  for (const text of texts) for (const match of text.matchAll(/(?<![\w:])(?:(\d{1,2}):)?(\d{1,3}):([0-5]\d)(?![\d:])/g)) {
    if (match[1] !== undefined && Number(match[2]) >= 60) continue
    const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3])
    if (seconds <= duration) requested.add(Math.min(last, seconds * 4))
  }
  const named = [...requested].sort((a, b) => a - b), selected = named.slice(0, 24), frames = new Set(selected)
  for (let i = 0; i < 8; i++) frames.add(Math.round(last * i / 7))
  return { frames: [...frames].sort((a, b) => a - b).map(frame => ({ frame, seconds: frame / 4, reason: selected.includes(frame) ? "timestamp" : "overview" })),
    omitted_timestamps: named.slice(24).map(frame => frame / 4) }
}

export async function sampleRecording(data: Buffer, type: "gif" | "mp4", index: number, directory: string, texts: string[]) {
  const video = path.join(directory, `video-${index}.${type}`), frames = path.join(directory, `frames-${index}`)
  await writeFile(video, data); await mkdir(frames)
  const env = { PATH: process.env.PATH }, format = type === "gif" ? "gif" : "mov"
  const input = ["-protocol_whitelist", "file,pipe", "-f", format, ...(type === "gif" ? ["-ignore_loop", "1"] : []), "-i", video]
  const probe = JSON.parse((await checked(["ffprobe", "-v", "error", ...input, "-select_streams", "v:0", "-show_entries", "format=duration:stream=duration", "-of", "json"],
    { env, timeout: 15_000, limit: 64 * 1024 })).toString())
  if (!probe.streams?.length) throw new Error("Recording has no video stream")
  const duration = Number(probe.streams[0].duration ?? probe.format?.duration), plan = recordingSamples(duration, texts)
  const select = plan.frames.map(({ frame }) => `eq(n,${frame})`).join("+")
  await checked(["ffmpeg", "-nostdin", "-v", "error", ...input, "-map", "0:v:0", "-an", "-sn", "-vf",
    `fps=4:start_time=0:eof_action=pass,select='${select}',scale=w=1280:h=1280:force_original_aspect_ratio=decrease`, "-fps_mode", "vfr", "-frames:v", String(plan.frames.length), path.join(frames, "%02d.png")],
    { env, timeout: 60_000 })
  const names = (await readdir(frames)).filter(name => name.endsWith(".png")).sort()
  if (names.length !== plan.frames.length) throw new Error("Recording could not supply the planned full-duration samples")
  const files: Record<string, string> = {}, samples: { path: string; seconds: number; reason: string }[] = []
  let bytes = 0
  for (const [i, name] of names.entries()) {
    const image = await readFile(path.join(frames, name)), file = `assets/${index}-frame-${name}`
    bytes += image.length
    if (bytes > 32 * 1024 * 1024) throw new Error("Recording frames exceed the 32 MiB ingestion limit")
    files[file] = image.toString("base64")
    samples.push({ path: file, seconds: plan.frames[i].seconds, reason: plan.frames[i].reason })
  }
  return { files, metadata: { duration_seconds: duration, sampled_frames: samples.map(sample => sample.path), frame_samples: samples,
    omitted_timestamps: plan.omitted_timestamps,
    limitations: "Still frames sampled on a quarter-second grid: up to eight overview positions spanning the recording and 24 supplied timestamps. Any omitted timestamps are listed; this is not full playback or verification of motion/audio." } }
}
