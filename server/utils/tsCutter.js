// Cuts the MPEG-TS stream ffmpeg writes into HLS segments that start exactly on given keyframes.
// ffmpeg's own segment muxer can't be trusted with that: depending on its version it counts the split times
// from different points, and its seeks into an MKV can land a keyframe or two early.

const PACKET = 188;
const SYNC = 0x47;
const TICKS = 90000; // MPEG-TS timestamps count 1/90000 seconds
const H264_TYPES = [0x1B];

function packetPid(packet) {
    return ((packet[1] & 0x1F) << 8) | packet[2];
}

// Where a packet's payload starts, or -1 when it has none
function payloadStart(packet) {
    const control = (packet[3] >> 4) & 0x3;
    if (!(control & 0x1)) return -1;
    const start = control & 0x2 ? 5 + packet[4] : 4;
    return start < PACKET ? start : -1;
}

// A 33 bit PTS from the 5 bytes at `offset`
function readTimestamp(buffer, offset) {
    return ((buffer[offset] >> 1) & 0x07) * 0x40000000
        + (buffer[offset + 1] << 22)
        + ((buffer[offset + 2] >> 1) << 15)
        + (buffer[offset + 3] << 7)
        + (buffer[offset + 4] >> 1);
}

// The elementary stream PIDs of a PMT, by stream type
function parsePmt(packet) {
    const start = payloadStart(packet);
    if (start === -1) return [];
    const table = start + 1 + packet[start]; // past the pointer field
    const sectionLength = ((packet[table + 1] & 0x0F) << 8) | packet[table + 2];
    const end = Math.min(PACKET, table + 3 + sectionLength - 4); // without the CRC
    const infoLength = ((packet[table + 10] & 0x0F) << 8) | packet[table + 11];
    const streams = [];
    for (let offset = table + 12 + infoLength; offset + 5 <= end;) {
        const type = packet[offset];
        const pid = ((packet[offset + 1] & 0x1F) << 8) | packet[offset + 2];
        const length = ((packet[offset + 3] & 0x0F) << 8) | packet[offset + 4];
        streams.push({ type, pid });
        offset += 5 + length;
    }
    return streams;
}

function parsePatPmtPid(packet) {
    const start = payloadStart(packet);
    if (start === -1) return null;
    const table = start + 1 + packet[start];
    // The first program after the 8 byte header; program 0 is the network PID and is skipped
    for (let offset = table + 8; offset + 4 <= PACKET - 4; offset += 4) {
        const program = (packet[offset] << 8) | packet[offset + 1];
        if (program !== 0) return ((packet[offset + 2] & 0x1F) << 8) | packet[offset + 3];
    }
    return null;
}

// Whether a video packet starts a keyframe: ffmpeg flags those as random access points, and for H.264 an
// IDR picture or a parameter set in the packet says so too
function isKeyframeStart(packet, payload) {
    const control = (packet[3] >> 4) & 0x3;
    if (control & 0x2 && packet[4] > 0 && packet[5] & 0x40) return true;
    for (let i = payload; i + 3 < PACKET; i++) {
        if (packet[i] === 0 && packet[i + 1] === 0 && packet[i + 2] === 1) {
            const type = packet[i + 3] & 0x1F;
            if (type === 5 || type === 7) return true;
        }
    }
    return false;
}

class TsCutter {
    /**
     * `boundaries` are the start times of every segment in seconds as the stream's timestamps put them, and
     * `tolerance` how far (seconds) from a boundary a keyframe may be to start that segment. A segment is
     * handed to `onSegment(index, buffer)` once the keyframe of the next one shows up, or at the end of the
     * stream. Whatever comes before the first keyframe on a boundary is dropped.
     */
    constructor({ boundaries, tolerance, onSegment }) {
        this.boundaries = boundaries.map(seconds => Math.round(seconds * TICKS));
        this.tolerance = Math.round(tolerance * TICKS);
        this.onSegment = onSegment;
        this.rest = null;
        this.pat = null;
        this.pmt = null;
        this.pmtPid = null;
        this.videoPid = null;
        this.current = null; // { index, packets }
        this.searchFrom = 0;
    }

    // The segment a keyframe at `pts` starts, or -1 when it's inside one
    segmentAt(pts) {
        const boundaries = this.boundaries;
        let low = this.searchFrom;
        let high = boundaries.length - 1;
        let found = -1;
        // The last boundary at or before the keyframe, give or take the tolerance
        while (low <= high) {
            const middle = (low + high) >> 1;
            if (boundaries[middle] <= pts + this.tolerance) {
                found = middle;
                low = middle + 1;
            } else {
                high = middle - 1;
            }
        }
        if (found === -1) return -1;
        return Math.abs(pts - boundaries[found]) <= this.tolerance ? found : -1;
    }

    write(chunk) {
        let data = this.rest ? Buffer.concat([this.rest, chunk]) : chunk;
        let offset = 0;
        // Back in step after garbage, which a healthy stream never has
        while (offset < data.length && data[offset] !== SYNC) offset++;
        for (; offset + PACKET <= data.length; offset += PACKET) {
            if (data[offset] !== SYNC) {
                while (offset < data.length && data[offset] !== SYNC) offset++;
                offset -= PACKET;
                continue;
            }
            this.packet(data.subarray(offset, offset + PACKET));
        }
        this.rest = offset < data.length ? Buffer.from(data.subarray(offset)) : null;
    }

    packet(packet) {
        const pid = packetPid(packet);
        const unitStart = !!(packet[1] & 0x40);

        if (pid === 0 && unitStart) {
            this.pat = Buffer.from(packet);
            this.pmtPid = parsePatPmtPid(packet);
        } else if (pid === this.pmtPid && unitStart) {
            this.pmt = Buffer.from(packet);
            const video = parsePmt(packet).find(stream => H264_TYPES.includes(stream.type) || stream.type === 0x24 || stream.type === 0x02);
            if (video) this.videoPid = video.pid;
        } else if (pid === this.videoPid && unitStart) {
            const payload = payloadStart(packet);
            // A PES header with a PTS: 00 00 01, stream id, length, flags, header length, PTS
            if (payload !== -1 && packet[payload] === 0 && packet[payload + 1] === 0 && packet[payload + 2] === 1
                && (packet[payload + 7] & 0x80) && isKeyframeStart(packet, payload + 9 + packet[payload + 8])) {
                const index = this.segmentAt(readTimestamp(packet, payload + 9));
                if (index !== -1 && (!this.current || index > this.current.index)) this.cut(index);
            }
        }

        if (this.current) this.current.packets.push(Buffer.from(packet));
    }

    cut(index) {
        // Only a segment that ran from its own boundary to the next one is complete
        if (this.current && index === this.current.index + 1) this.emit();
        this.current = { index, packets: [] };
        this.searchFrom = index;
        if (this.pat && this.pmt) this.current.packets.push(this.pat, this.pmt);
    }

    emit() {
        const { index, packets } = this.current;
        this.current = null;
        if (packets.length > 2) this.onSegment(index, Buffer.concat(packets));
    }

    // The stream reached the end of the file, so the last segment is complete too
    end() {
        if (this.current && this.current.index === this.boundaries.length - 1) this.emit();
        this.current = null;
    }
}

module.exports = { TsCutter };
