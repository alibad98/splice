import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { VIDEO_RENDITION_TIERS, type RenditionProfile } from '@slips/contracts';
import type { ProcessedRendition } from '../../ports/media-processor.js';
import { DevMediaProcessor } from './dev-media-processor.js';

const run = promisify(execFile);

/** Real local transcoding. The deterministic development adapter is reserved for test fixtures. */
export class FfmpegMediaProcessor extends DevMediaProcessor {
  constructor(private readonly executable = 'ffmpeg') { super(); }

  override async processVideo(bytes: Buffer, contentType = 'video/mp4'): Promise<ProcessedRendition[]> {
    const source = await this.probe(bytes, contentType);
    const shortSide = Math.min(source.width, source.height);
    const directory = await mkdtemp(join(tmpdir(), 'slips-media-'));
    // Only ever recursively remove the exact temporary child created for this invocation.
    if (dirname(directory) !== resolve(tmpdir())) throw new Error('Invalid media temporary directory');
    try {
      const input = join(directory, 'source');
      await writeFile(input, bytes);
      const outputs: ProcessedRendition[] = [];
      const encode = async (args: string[]) => {
        try {
          await run(this.executable, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
            '-protocol_whitelist', 'file,pipe', '-threads', '2', '-i', input, ...args],
          { timeout: 5 * 60_000, maxBuffer: 1024 * 1024, windowsHide: true });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('FFmpeg is required for video processing; install it or configure FFMPEG_PATH', { cause: error });
          throw error;
        }
      };
      for (const tier of VIDEO_RENDITION_TIERS.filter(value => value <= shortSide)) {
        const width = source.width <= source.height ? tier : Math.max(2, Math.round(source.width * tier / shortSide / 2) * 2);
        const height = source.height <= source.width ? tier : Math.max(2, Math.round(source.height * tier / shortSide / 2) * 2);
        const profile = `${tier}p` as RenditionProfile;
        const output = join(directory, `${profile}.mp4`);
        await encode(['-map', '0:v:0', '-map', '0:a:0?', '-vf', `scale=${width}:${height},setsar=1`,
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-threads', '2',
          '-c:a', 'aac', '-b:a', '128k', '-map_metadata', '-1', '-map_chapters', '-1', '-movflags', '+faststart', output]);
        outputs.push({ profile, contentType: 'video/mp4', width, height, bytes: await readFile(output) });
      }
      if (outputs.length === 0) throw new Error('Video is below the minimum rendition resolution');
      const poster = join(directory, 'poster.webp');
      await encode(['-map', '0:v:0', '-frames:v', '1', '-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1',
        '-c:v', 'libwebp', '-quality', '82', '-threads', '2', '-map_metadata', '-1', poster]);
      outputs.push({ profile: 'poster', contentType: 'image/webp', width: 720, height: 1280, bytes: await readFile(poster) });
      return outputs;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
