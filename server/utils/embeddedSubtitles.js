const { spawn } = require('child_process');
const { FFMPEG } = require('./media');

// Subtitles inside a video file (mostly MKV) are spread over the whole file between its pictures and sound,
// so they can only be read as the file comes in. ffmpeg reads a stretch of the file from where the viewer is
// and turns the track's lines into WebVTT cues, which go to the player as they're found.

// Text tracks, which become WebVTT. Pictures of text (Blu-ray PGS, DVD) can't.
const TEXT_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text']);

function isTextSubtitle(track) {
    return TEXT_CODECS.has(track.codec);
}

// "01:02:03.456" or "02:03.456" in seconds
function parseTimestamp(text) {
    const parts = text.trim().split(':').map(Number);
    if (parts.length < 2 || parts.length > 3 || parts.some(part => !Number.isFinite(part))) return null;
    return Math.round(parts.reduce((total, part) => total * 60 + part, 0) * 1000) / 1000;
}

// One block of ffmpeg's WebVTT output as a cue, or null for the header and blocks without one
function parseBlock(block) {
    const lines = block.split(/\r?\n/);
    const timing = lines.findIndex(line => line.includes('-->'));
    if (timing === -1) return null;
    const [startText, rest] = lines[timing].split('-->');
    const start = parseTimestamp(startText);
    const end = parseTimestamp(rest.trim().split(/\s+/)[0]);
    const text = lines.slice(timing + 1).join('\n').trim();
    if (start === null || end === null || !text) return null;
    return { start, end, text };
}

// Turns WebVTT that comes in pieces into cues, each as soon as the blank line after it is there
class VttReader {
    constructor() {
        this.rest = '';
    }

    push(chunk) {
        const blocks = (this.rest + chunk).split(/\r?\n\r?\n/);
        this.rest = blocks.pop();
        return blocks.map(parseBlock).filter(Boolean);
    }

    end() {
        const last = parseBlock(this.rest);
        this.rest = '';
        return last ? [last] : [];
    }
}

/**
 * Reads subtitle track `track` (its place among the file's subtitle tracks, like ffmpeg's -map 0:s:N) of the
 * video at `inputUrl` from second `from` up to second `to` (or the end), calling `onCues` with the cues
 * ({ start, end, text } in seconds of the video) as they're found. Resolves when the stretch is read; rejects
 * when ffmpeg fails. Aborting `signal` stops ffmpeg.
 */
function extractSubtitles({ inputUrl, track, from = 0, to = null, onCues, signal }) {
    return new Promise((resolve, reject) => {
        const args = ['-hide_banner', '-nostdin', '-loglevel', 'error'];
        // ffmpeg starts on the keyframe before `from`, so the lines that just began come along too
        if (from > 0) args.push('-ss', from.toFixed(3));
        args.push(
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '30',
            // Times stay those of the file, counted from its start like the player counts them
            '-copyts',
            '-start_at_zero',
            '-i', inputUrl,
            '-map', `0:s:${track}`
        );
        if (to !== null) args.push('-to', to.toFixed(3));
        args.push('-c:s', 'webvtt', '-flush_packets', '1', '-f', 'webvtt', 'pipe:1');

        const reader = new VttReader();
        const child = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        let settled = false;
        const finish = (err) => {
            if (settled) return;
            settled = true;
            if (signal) signal.removeEventListener('abort', stop);
            if (err) reject(err);
            else resolve();
        };
        const kill = () => {
            try { child.kill('SIGKILL'); } catch (err) { /* already gone */ }
        };
        const stop = () => {
            kill();
            finish(Object.assign(new Error('Stopped'), { code: 'aborted' }));
        };
        // ffmpeg's -to stops it at the end of the stretch; so does the first line after it, whatever its version
        const deliver = (cues) => {
            if (settled) return;
            const wanted = to === null ? cues : cues.filter(cue => cue.start < to);
            if (wanted.length) onCues(wanted);
            if (wanted.length < cues.length) {
                kill();
                finish();
            }
        };
        if (signal) {
            if (signal.aborted) return stop();
            signal.addEventListener('abort', stop);
        }

        child.stdout.setEncoding('utf8');
        child.stdout.on('data', chunk => deliver(reader.push(chunk)));
        child.stderr.on('data', (chunk) => {
            stderr = (stderr + chunk).slice(-2000);
        });
        child.on('error', err => finish(err));
        child.on('close', (code) => {
            if (settled) return;
            deliver(reader.end());
            if (code === 0) return finish();
            const message = stderr.trim().split('\n').pop() || `ffmpeg exited with ${code}`;
            finish(new Error(message));
        });
    });
}

module.exports = { extractSubtitles, isTextSubtitle, VttReader };
