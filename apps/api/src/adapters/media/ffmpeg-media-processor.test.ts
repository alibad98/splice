import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { FfmpegMediaProcessor } from './ffmpeg-media-processor.js';
import { buildMp4Buffer } from './dev-media-processor.js';

const run = promisify(execFile);
const executable = process.env.FFMPEG_PATH || 'ffmpeg';
it('encodes playable source frames and audio, a real poster, and no upscaled tier', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'slips-media-test-'));
  if (dirname(directory) !== resolve(tmpdir())) throw new Error('Invalid test directory');
  try {
    const input = join(directory, 'input.mp4');
    await run(executable, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=8',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '0.5', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', input]);
    const output = await new FfmpegMediaProcessor(executable).processVideo(await readFile(input), 'video/mp4');
    expect(output.map(value => value.profile)).toEqual(['480p', '720p', 'poster']);
    for (const rendition of output.filter(value => value.contentType === 'video/mp4')) {
      const file = join(directory, `${rendition.profile}.mp4`);
      await writeFile(file, rendition.bytes);
      const decoded = await run(executable, ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:v:0', '-map', '0:a:0', '-f', 'framemd5', '-']);
      expect(decoded.stdout).toContain(`#dimensions 0: ${rendition.width}x${rendition.height}`);
      expect(decoded.stdout).toContain('#media_type 1: audio');
      expect(decoded.stdout.split('\n').filter(line => line.startsWith('0,')).length).toBeGreaterThan(1);
      // Real decoded frames, rather than just an MP4 header or a synthetic hash payload.
      expect(rendition.bytes.length).toBeGreaterThan(1000);
    }
    const poster = output.find(value => value.profile === 'poster')!;
    expect(await sharp(poster.bytes).metadata()).toMatchObject({ format: 'webp', width: 720, height: 1280 });
    const stats = await sharp(poster.bytes).stats();
    expect(stats.channels.some(channel => channel.stdev > 20)).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

it('rejects header-only synthetic MP4 instead of reporting playable renditions', async () => {
  await expect(new FfmpegMediaProcessor(executable).processVideo(buildMp4Buffer(720, 1280), 'video/mp4')).rejects.toThrow();
});

it('reports a missing executable rather than generating placeholder media', async () => {
  await expect(new FfmpegMediaProcessor('slips-missing-ffmpeg').processVideo(buildMp4Buffer(720, 1280), 'video/mp4'))
    .rejects.toThrow('FFmpeg is required');
});
