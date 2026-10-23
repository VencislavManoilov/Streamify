import { session } from './session';

// Subtitles inside the video file come from the server in stretches of a few minutes around where the viewer
// is, read from the file while its torrent brings it in (see the server's utils/embeddedSubtitles.js). Their
// cues are added to a text track of the video as they arrive.

// Seconds of the video one request reads
const STRETCH = 5 * 60;
// The next stretch is asked for when the read ones end this many seconds after where the video is
const LOOK_AHEAD = 90;
// A request that broke off is made again after this long
const RETRY_AFTER = 10 * 1000;
// A seek this far past the last line read starts reading there, instead of through the part that's skipped
const SKIP = 30;

// An empty WebVTT file for the text track to load, so it counts as loaded while its cues come from here
let emptyTrackUrl = null;
export function emptyTrackSrc() {
    if (!emptyTrackUrl) emptyTrackUrl = URL.createObjectURL(new Blob(['WEBVTT\n\n'], { type: 'text/vtt' }));
    return emptyTrackUrl;
}

export class SubtitleStream {
    /**
     * `url` answers with the cues from `?from=` to `&to=` seconds, `getTrack()` is the TextTrack they go to,
     * `onStatus(status)` hears 'loading', 'ready' or 'error', and `onCues()` that cues were added.
     */
    constructor({ url, getTrack, onStatus, onCues }) {
        this.url = url;
        this.getTrack = getTrack;
        this.onStatus = onStatus;
        this.onCues = onCues;
        this.read = []; // [from, to] stretches read to the end, in order and apart from each other
        this.running = null; // { from, to, reached (the start of its last cue), controller }
        this.seen = new Set();
        this.failedAt = 0;
        this.broken = false;
        this.status = 'idle';
    }

    // Called with where the video is while these subtitles are on, and with `seeking` when it jumps there
    update(time, duration = Infinity, seeking = false) {
        if (this.broken || !Number.isFinite(time)) return;
        const run = this.running;
        const inRun = !!run && time >= run.from - 1 && time < run.to && !(seeking && time > run.reached + SKIP);
        const stretch = this.read.find(([from, to]) => time >= from - 1 && time < to);

        if (stretch) {
            const end = stretch[1];
            // Reading on from the end of this stretch is the only reading that's of use now
            if (run && !(run.from <= end + 1 && run.to > end)) this.stop();
            if (!this.running && end - time < LOOK_AHEAD && end < duration && this.canRetry()) this.request(end);
            return;
        }
        if (inRun) return;
        if (run) this.stop();
        if (this.canRetry()) this.request(Math.max(0, time));
    }

    canRetry() {
        return Date.now() - this.failedAt > RETRY_AFTER;
    }

    // Stops reading; the cues already there stay
    stop() {
        if (!this.running) return;
        this.running.controller.abort();
        this.running = null;
    }

    setStatus(status) {
        if (this.status === status) return;
        this.status = status;
        this.onStatus(status);
    }

    async request(from) {
        const run = { from, to: from + STRETCH, reached: from, controller: new AbortController() };
        this.running = run;
        if (!this.seen.size) this.setStatus('loading');

        try {
            const headers = session.token ? { Authorization: session.token } : {};
            const response = await fetch(`${this.url}?from=${from.toFixed(1)}&to=${run.to.toFixed(1)}`, { headers, signal: run.controller.signal });
            if (!response.ok || !response.body) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let rest = '';
            let finished = false;
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                rest += decoder.decode(value, { stream: true });
                const lines = rest.split('\n');
                rest = lines.pop();
                for (const line of lines) finished = this.take(line, run) || finished;
            }
            if (rest) finished = this.take(rest, run) || finished;
            if (!finished && !this.broken) throw new Error('The subtitles stopped coming');
        } catch (err) {
            if (run.controller.signal.aborted) return;
            this.failedAt = Date.now();
            // Without the episode or the right to see it, asking again won't help
            if (err.status === 401 || err.status === 404) this.fail();
        } finally {
            if (this.running === run) this.running = null;
        }
    }

    // Handles a line of the answer; true when it says the stretch is read to the end
    take(line, run) {
        let message;
        try {
            message = JSON.parse(line);
        } catch (err) {
            return false;
        }
        if (message.cues) {
            this.add(message.cues);
            run.reached = Math.max(run.reached, ...message.cues.map(([start]) => start));
        }
        if (message.error) this.fail();
        if (!message.done) return false;
        this.cover(run.from, run.to);
        this.setStatus('ready');
        return true;
    }

    add(cues) {
        const track = this.getTrack();
        if (!track) return;
        let added = false;
        for (const [start, end, text] of cues) {
            const key = `${start}|${text}`;
            if (this.seen.has(key)) continue;
            this.seen.add(key);
            track.addCue(new VTTCue(start, end, text));
            added = true;
        }
        if (!added) return;
        this.setStatus('ready');
        this.onCues();
    }

    fail() {
        this.broken = true;
        this.stop();
        // Lines that came before the problem still show
        this.setStatus(this.seen.size ? 'ready' : 'error');
    }

    cover(from, to) {
        const stretches = [...this.read, [from, to]].sort((a, b) => a[0] - b[0]);
        this.read = stretches.reduce((merged, [start, end]) => {
            const last = merged[merged.length - 1];
            if (last && start <= last[1] + 1) {
                last[1] = Math.max(last[1], end);
            } else {
                merged.push([start, end]);
            }
            return merged;
        }, []);
    }
}
