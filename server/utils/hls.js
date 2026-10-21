const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const logger = require('./logger');
const { FFMPEG } = require('./media');
const { TsCutter } = require('./tsCutter');

/**
 * Turns a video the browser can't play into HLS: a playlist of short MPEG-TS segments that hls.js (or Safari
 * itself) plays. Segments are made on demand by ffmpeg, which reads the video from the torrent while it
 * downloads. A seek past what's made starts a new ffmpeg run there.
 *
 * - 'copy' keeps the video as it is and only converts the audio to AAC. Every segment starts on a keyframe
 *   taken from the file's own index, so a run started anywhere cuts exactly the same segments.
 * - 'transcode' encodes the video again as H.264 with keyframes forced on a fixed grid. It takes a lot of CPU
 *   and is only used for video the browser can't decode.
 *
 * ffmpeg writes one MPEG-TS stream and utils/tsCutter.js cuts it into the segments.
 */

// A 'copy' segment runs from one keyframe to the first one at least this many seconds later
const COPY_TARGET = 4;
const TRANSCODE_SEGMENT = 4;
// Added to every timestamp, so the audio encoder's priming before the first frame never goes below zero
const TS_OFFSET = 10;
// For video with B-frames ffmpeg seeks this much before -ss, which would land on the keyframe before ours
const SEEK_BACKOFF = 3 / 23;
// A keyframe this close after another can't be told apart from it when seeking
const KEYFRAME_GAP = 0.14;
// A running job is waited for when it is at most this many segments away from the one asked for
const LOOKAHEAD = 5;
// Seconds a job may get ahead of the viewer before it is paused, so a video watched for a minute isn't
// downloaded and converted to the end
const AHEAD_LIMIT = 150;
const JOB_IDLE = 90 * 1000;
const SESSION_IDLE = 30 * 60 * 1000;
const SEGMENT_WAIT = 100 * 1000;
const MAX_JOBS = Number(process.env.HLS_MAX_JOBS) || 6;
const MAX_FAILURES = 3;

function round(seconds) {
    return Math.round(seconds * 1000) / 1000;
}

// Segments from the keyframes of the file. Keyframes right after another one are left out, see KEYFRAME_GAP.
function copySegments(keyframes, duration, startTime) {
    const end = startTime + duration;
    const usable = keyframes.filter((time, index) => time < end - 0.5
        && (index + 1 >= keyframes.length || keyframes[index + 1] - time > KEYFRAME_GAP));
    if (!usable.length) return null;

    const bounds = [usable[0]];
    for (const time of usable) {
        if (time >= bounds[bounds.length - 1] + COPY_TARGET) bounds.push(time);
    }
    return bounds.map((start, index) => ({
        start,
        end: index + 1 < bounds.length ? bounds[index + 1] : Math.max(end, start + 0.1)
    }));
}

function gridSegments(duration, startTime) {
    const segments = [];
    for (let start = 0; start < duration; start += TRANSCODE_SEGMENT) {
        segments.push({ start: startTime + start, end: startTime + Math.min(duration, start + TRANSCODE_SEGMENT) });
    }
    // A last bit too short to hold a frame of its own goes to the segment before it
    const last = segments[segments.length - 1];
    if (segments.length > 1 && last.end - last.start < 1) {
        segments.pop();
        segments[segments.length - 1].end = last.end;
    }
    return segments;
}

/**
 * What the playlist of a video is made of. `info` is what media.probe found, `video` is 'copy' or
 * 'transcode' and `keyframes` (seconds) are needed for 'copy'.
 */
function buildPlan(info, { video, audio, keyframes }) {
    const duration = info.duration;
    if (!duration || duration <= 0 || !info.video) return null;
    const segments = video === 'copy'
        ? copySegments(keyframes || [], duration, info.startTime || 0)
        : gridSegments(duration, info.startTime || 0);
    if (!segments || !segments.length) return null;

    return {
        video,
        videoHeight: info.video.height,
        audio: audio ? { position: audio.position, codec: audio.codec, channels: audio.channels } : null,
        duration,
        segments
    };
}

class Job {
    constructor(session, start, service) {
        this.session = session;
        this.service = service;
        this.start = start;
        this.next = start; // the next segment this job finishes
        this.paused = false;
        this.killed = false;
        this.done = false;
        this.produced = 0;
        this.stderr = '';
        this.writing = Promise.resolve();

        const plan = session.plan;
        this.cutter = new TsCutter({
            boundaries: plan.segments.map(segment => segment.start + TS_OFFSET),
            // An encoded video's keyframes are on the frame nearest each grid line, a copied one's exactly on it
            tolerance: plan.video === 'transcode' ? 0.1 : 0.002,
            onSegment: (index, data) => this.save(index, data)
        });

        this.process = spawn(FFMPEG, this.args(), { stdio: ['ignore', 'pipe', 'pipe'] });
        this.process.stdout.on('data', chunk => this.cutter.write(chunk));
        this.process.stderr.on('data', (chunk) => {
            this.stderr = (this.stderr + chunk).slice(-4000);
        });
        this.process.on('error', (err) => {
            this.stderr += `\n${err.message}`;
        });
        this.process.on('close', code => this.onClose(code));
    }

    args() {
        const { plan, inputUrl } = this.session;
        const segment = plan.segments[this.start];
        const args = ['-hide_banner', '-nostdin', '-loglevel', 'error'];
        const transcoding = plan.video === 'transcode';

        if (this.start > 0) {
            // An encoded video starts exactly where it should. A copied one starts on the keyframe the seek
            // lands on, which may be an earlier one; the cutter drops what comes before the segment.
            if (transcoding) {
                args.push('-ss', segment.start.toFixed(3));
            } else {
                args.push('-noaccurate_seek', '-ss', (segment.start + SEEK_BACKOFF + 0.002).toFixed(3));
            }
        }

        args.push(
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '30',
            '-copyts',
            '-i', inputUrl,
            // V leaves out cover pictures some files carry as video
            '-map', '0:V:0'
        );
        if (plan.audio) args.push('-map', `0:a:${plan.audio.position}`);

        if (transcoding) {
            const settings = this.service.transcode;
            const height = Math.min(plan.videoHeight || settings.maxHeight, settings.maxHeight);
            // Keyframes only on the segment grid, so every run cuts the same segments. A list of times is
            // compared with the frames' own timestamps; an expression's time would count from where the run started.
            const grid = plan.segments.slice(this.start + 1).map(next => next.start.toFixed(3));
            args.push(
                '-c:v', 'libx264',
                '-preset', settings.preset,
                '-crf', String(settings.crf),
                '-maxrate', '12M',
                '-bufsize', '24M',
                '-profile:v', 'high',
                '-pix_fmt', 'yuv420p',
                '-vf', `scale=-2:${height - (height % 2)}`,
                '-sc_threshold', '0',
                '-g', '9999',
                ...(grid.length ? ['-force_key_frames', grid.join(',')] : [])
            );
        } else {
            args.push('-c:v', 'copy');
        }

        if (plan.audio) {
            if (plan.audio.codec === 'aac' && plan.audio.channels <= 2) {
                args.push('-c:a', 'copy');
            } else {
                args.push('-c:a', 'aac', '-ac', '2', '-b:a', '192k');
            }
        }

        args.push(
            '-sn', '-dn',
            '-max_muxing_queue_size', '4096',
            '-output_ts_offset', String(TS_OFFSET),
            '-muxdelay', '0',
            '-muxpreload', '0',
            '-mpegts_copyts', '1',
            '-f', 'mpegts',
            'pipe:1'
        );
        return args;
    }

    get alive() {
        return !this.done && !this.killed;
    }

    // Segments are written one after another, so they reach the session in order
    save(index, data) {
        this.next = Math.max(this.next, index + 1);
        this.writing = this.writing.then(async () => {
            const file = path.join(this.session.dir, `seg-${index}.ts.part`);
            await fs.promises.writeFile(file, data);
            await this.session.adopt(index, file);
            this.produced += 1;
        }).catch((err) => {
            logger.warn(`Could not save a segment of "${this.session.name}": ${err.message}`);
        });
    }

    async onClose(code) {
        this.done = true;
        // Only a run that reached the end of the file finished its last segment
        if (code === 0 && !this.killed) this.cutter.end();
        await this.writing;
        if (!this.killed && code !== 0) {
            const reason = this.stderr.trim().split('\n').slice(-3).join(' | ') || `exit code ${code}`;
            logger.warn(`Converting "${this.session.name}" from segment ${this.start} failed: ${reason}`);
        }
        this.session.jobEnded(this, !this.killed && code !== 0);
    }

    // Not read anymore, ffmpeg stops as soon as the pipe is full, and so does its reading of the torrent
    pause() {
        if (this.paused || !this.alive) return;
        this.paused = true;
        this.process.stdout.pause();
    }

    resume() {
        if (!this.paused) return;
        this.paused = false;
        this.process.stdout.resume();
    }

    kill() {
        if (!this.alive) return;
        this.killed = true;
        try { this.process.kill('SIGKILL'); } catch (err) { /* already gone */ }
    }
}

class Session {
    constructor(service, key, { name, inputUrl, plan }) {
        this.service = service;
        this.key = key;
        this.name = name;
        this.inputUrl = inputUrl;
        this.plan = plan;
        this.dir = path.join(service.cacheDir, key.replace(/[^a-z0-9-]/gi, '_'));
        this.ready = new Set();
        this.waiters = new Map(); // segment -> [{ resolve, reject, timer }]
        this.jobs = new Set();
        this.failures = 0;
        this.lastRequested = 0;
        this.lastActivity = Date.now();
        fs.mkdirSync(this.dir, { recursive: true });
    }

    segmentPath(index) {
        return path.join(this.dir, `seg-${index}.ts`);
    }

    playlist() {
        const durations = this.plan.segments.map(segment => segment.end - segment.start);
        const lines = [
            '#EXTM3U',
            '#EXT-X-VERSION:3',
            `#EXT-X-TARGETDURATION:${Math.ceil(Math.max(...durations))}`,
            '#EXT-X-PLAYLIST-TYPE:VOD',
            '#EXT-X-MEDIA-SEQUENCE:0'
        ];
        durations.forEach((duration, index) => {
            lines.push(`#EXTINF:${round(duration).toFixed(3)},`, `seg-${index}.ts`);
        });
        lines.push('#EXT-X-ENDLIST', '');
        return lines.join('\n');
    }

    touch(index) {
        this.lastActivity = Date.now();
        if (Number.isInteger(index)) this.lastRequested = index;
    }

    async adopt(index, file) {
        const target = this.segmentPath(index);
        if (this.ready.has(index)) {
            await fs.promises.rm(file, { force: true });
        } else {
            await fs.promises.rename(file, target);
            this.ready.add(index);
            this.failures = 0;
        }
        const waiting = this.waiters.get(index) || [];
        this.waiters.delete(index);
        waiting.forEach(waiter => {
            clearTimeout(waiter.timer);
            waiter.resolve(target);
        });
    }

    jobEnded(job, failed) {
        this.jobs.delete(job);
        // A job that was stopped on purpose had nobody waiting for it (see startJob)
        if (job.killed) return;
        if (failed && job.produced === 0) this.failures += 1;

        // Whoever still waits gets a new job, unless converting keeps failing
        const waiting = [...this.waiters.keys()].sort((a, b) => a - b);
        if (!waiting.length) return;
        if (this.failures >= MAX_FAILURES) {
            this.rejectAll(new Error('The video could not be converted'));
            return;
        }
        if (!this.findJob(waiting[0])) this.startJob(waiting[0]);
    }

    // Whether someone waits for a segment the job is making or about to make
    isWanted(job) {
        return [...this.waiters.keys()].some(index => job.start <= index && index <= job.next + LOOKAHEAD);
    }

    rejectAll(err) {
        for (const waiting of this.waiters.values()) {
            waiting.forEach(waiter => {
                clearTimeout(waiter.timer);
                waiter.reject(err);
            });
        }
        this.waiters.clear();
    }

    findJob(index) {
        return [...this.jobs].find(job => job.alive && job.start <= index && index <= job.next + LOOKAHEAD);
    }

    startJob(index) {
        // The viewer jumped somewhere else, so what the other jobs download and convert isn't needed anymore,
        // unless someone else waits for it
        this.jobs.forEach((other) => {
            if (!this.isWanted(other)) other.kill();
        });
        this.service.makeRoom(this);
        const job = new Job(this, index, this.service);
        this.jobs.add(job);
        logger.info(`Converting "${this.name}" from ${Math.round(this.plan.segments[index].start)}s (${this.plan.video === 'copy' ? 'audio only' : 'video and audio'})`);
        return job;
    }

    async segment(index) {
        if (!Number.isInteger(index) || index < 0 || index >= this.plan.segments.length) {
            throw Object.assign(new Error('No such segment'), { status: 404 });
        }
        this.touch(index);
        if (this.ready.has(index)) return this.segmentPath(index);
        if (this.failures >= MAX_FAILURES) this.failures = 0; // asked again later, so try once more

        const job = this.findJob(index) || this.startJob(index);
        job.resume();

        return new Promise((resolve, reject) => {
            const waiter = { resolve, reject };
            waiter.timer = setTimeout(() => {
                const list = (this.waiters.get(index) || []).filter(other => other !== waiter);
                if (list.length) this.waiters.set(index, list); else this.waiters.delete(index);
                reject(Object.assign(new Error('The segment took too long'), { status: 503 }));
            }, SEGMENT_WAIT);
            this.waiters.set(index, [...(this.waiters.get(index) || []), waiter]);
        });
    }

    averageSegment() {
        return this.plan.duration / this.plan.segments.length;
    }

    // Runs every few seconds: pauses jobs far ahead of the viewer and stops the ones nobody needs anymore
    tick(now) {
        // A request waiting for a slow torrent counts as activity
        if (this.waiters.size) this.lastActivity = now;
        const idle = now - this.lastActivity;
        const ahead = Math.max(2, Math.round(AHEAD_LIMIT / this.averageSegment()));
        for (const job of this.jobs) {
            if (idle > JOB_IDLE) {
                job.kill();
            } else if (job.next > this.lastRequested + ahead) {
                job.pause();
            } else if (job.next <= this.lastRequested + ahead / 2) {
                job.resume();
            }
        }
        return idle > SESSION_IDLE && !this.jobs.size;
    }

    destroy() {
        this.jobs.forEach(job => job.kill());
        this.rejectAll(new Error('The video was closed'));
        fs.rm(this.dir, { recursive: true, force: true }, () => {});
    }
}

class HlsService {
    constructor({ cacheDir, transcode = {} }) {
        this.cacheDir = cacheDir;
        this.transcode = {
            enabled: transcode.enabled !== false,
            maxHeight: transcode.maxHeight || 1080,
            preset: transcode.preset || 'veryfast',
            crf: transcode.crf || 21
        };
        this.sessions = new Map();

        // Segments of a previous run are useless, the sessions they belonged to are gone
        fs.rmSync(cacheDir, { recursive: true, force: true });
        fs.mkdirSync(cacheDir, { recursive: true });

        this.timer = setInterval(() => this.tick(), 2000);
        this.timer.unref();
        process.once('exit', () => this.sessions.forEach(session => session.jobs.forEach(job => job.kill())));
    }

    get(key) {
        return this.sessions.get(key) || null;
    }

    // The session for a converted video, made from `options` ({ name, inputUrl, plan }) the first time
    open(key, options) {
        let session = this.sessions.get(key);
        if (!session) {
            session = new Session(this, key, options);
            this.sessions.set(key, session);
        } else {
            // The torrent may have been loaded again under a new address
            session.inputUrl = options.inputUrl;
        }
        session.touch();
        return session;
    }

    // Stops the least recently watched job when too many run at once
    makeRoom(except) {
        const jobs = [...this.sessions.values()].flatMap(session => [...session.jobs].filter(job => job.alive));
        if (jobs.length < MAX_JOBS) return;
        const victim = jobs
            .filter(job => job.session !== except)
            .sort((a, b) => a.session.lastActivity - b.session.lastActivity)[0];
        if (victim) victim.kill();
    }

    tick() {
        const now = Date.now();
        for (const [key, session] of this.sessions) {
            if (session.tick(now)) {
                session.destroy();
                this.sessions.delete(key);
            }
        }
    }

    stats() {
        const sessions = [...this.sessions.values()];
        return {
            sessions: sessions.length,
            jobs: sessions.reduce((total, session) => total + [...session.jobs].filter(job => job.alive).length, 0)
        };
    }
}

module.exports = { HlsService, buildPlan };
