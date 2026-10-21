// Reads just enough of a Matroska (MKV) file to play it: its tracks (codecs, languages...) from the header
// and where its video keyframes are from the Cues element, which lets the video be cut into pieces that each
// start on a keyframe without re-encoding it (see utils/hls.js). The video itself is never read, so only the
// start and the end of the file have to be downloaded.

const ID = {
    EBML: 0x1A45DFA3,
    SEGMENT: 0x18538067,
    SEEK_HEAD: 0x114D9B74,
    SEEK: 0x4DBB,
    SEEK_ID: 0x53AB,
    SEEK_POSITION: 0x53AC,
    INFO: 0x1549A966,
    TIMESTAMP_SCALE: 0x2AD7B1,
    DURATION: 0x4489,
    TRACKS: 0x1654AE6B,
    TRACK_ENTRY: 0xAE,
    TRACK_NUMBER: 0xD7,
    TRACK_TYPE: 0x83,
    CODEC_ID: 0x86,
    CODEC_PRIVATE: 0x63A2,
    NAME: 0x536E,
    LANGUAGE: 0x22B59C,
    LANGUAGE_BCP47: 0x22B59D,
    FLAG_DEFAULT: 0x88,
    VIDEO: 0xE0,
    PIXEL_WIDTH: 0xB0,
    PIXEL_HEIGHT: 0xBA,
    COLOUR: 0x55B0,
    TRANSFER: 0x55BA,
    AUDIO: 0xE1,
    CHANNELS: 0x9F,
    CUES: 0x1C53BB6B,
    CUE_POINT: 0xBB,
    CUE_TIME: 0xB3,
    CUE_TRACK_POSITIONS: 0xB7,
    CUE_TRACK: 0xF7,
    CLUSTER: 0x1F43B675
};

const VIDEO_TRACK = 1;
const AUDIO_TRACK = 2;
const HEAD_BYTES = 256 * 1024;
// The index is nearly always at the end, so the end is read together with the start instead of after it
const TAIL_BYTES = 2 * 1024 * 1024;
// A two hour movie has a few hundred kilobytes of cues, anything near this is not a real index
const MAX_CUES_BYTES = 32 * 1024 * 1024;
const MAX_HEADER_ELEMENT = 4 * 1024 * 1024;

// Matroska codec IDs, named like ffmpeg names them
const VIDEO_CODECS = { 'V_MPEG4/ISO/AVC': 'h264', 'V_MPEGH/ISO/HEVC': 'hevc', V_AV1: 'av1', V_VP9: 'vp9', V_VP8: 'vp8', 'V_MPEG4/ISO/ASP': 'mpeg4', 'V_MPEG4/ISO/SP': 'mpeg4', V_MPEG2: 'mpeg2video' };
const AUDIO_CODECS = { A_AC3: 'ac3', A_EAC3: 'eac3', A_DTS: 'dts', A_TRUEHD: 'truehd', A_OPUS: 'opus', A_VORBIS: 'vorbis', A_FLAC: 'flac', 'A_MPEG/L3': 'mp3', 'A_MPEG/L2': 'mp2' };

// An element ID keeps its length marker, e.g. 0x1A45DFA3
function readId(buffer, offset) {
    const first = buffer[offset];
    if (first === undefined) return null;
    let length = 1;
    while (length <= 4 && !(first & (0x80 >> (length - 1)))) length++;
    if (length > 4 || offset + length > buffer.length) return null;
    let id = 0;
    for (let i = 0; i < length; i++) id = id * 256 + buffer[offset + i];
    return { id, length };
}

// A size drops its length marker. All bits set means the size isn't known (allowed for Segment and Cluster).
function readSize(buffer, offset) {
    const first = buffer[offset];
    if (first === undefined) return null;
    let length = 1;
    while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
    if (length > 8 || offset + length > buffer.length) return null;
    let value = first & (0xFF >> length);
    let unknown = value === (0xFF >> length);
    for (let i = 1; i < length; i++) {
        const byte = buffer[offset + i];
        value = value * 256 + byte;
        if (byte !== 0xFF) unknown = false;
    }
    return { size: unknown ? null : value, length };
}

function readHeader(buffer, offset) {
    const id = readId(buffer, offset);
    if (!id) return null;
    const size = readSize(buffer, offset + id.length);
    if (!size) return null;
    return { id: id.id, size: size.size, headerLength: id.length + size.length };
}

function readUint(buffer, offset, length) {
    let value = 0;
    for (let i = 0; i < length; i++) value = value * 256 + buffer[offset + i];
    return value;
}

function readFloat(buffer, offset, length) {
    if (length === 4) return buffer.readFloatBE(offset);
    if (length === 8) return buffer.readDoubleBE(offset);
    return 0;
}

function readString(buffer, offset, length) {
    return buffer.toString('utf8', offset, offset + length).replace(/\0+$/, '');
}

// Calls `visit(id, dataStart, size)` for every direct child in buffer[start, end)
function children(buffer, start, end, visit) {
    let offset = start;
    while (offset < end) {
        const header = readHeader(buffer, offset);
        if (!header || header.size === null) return;
        const dataStart = offset + header.headerLength;
        if (dataStart + header.size > end) return;
        visit(header.id, dataStart, header.size);
        offset = dataStart + header.size;
    }
}

function parseSeekHead(buffer) {
    const positions = new Map(); // element ID -> position from the start of the segment's data
    children(buffer, 0, buffer.length, (id, dataStart, size) => {
        if (id !== ID.SEEK) return;
        let seekId = null;
        let position = null;
        children(buffer, dataStart, dataStart + size, (childId, childStart, childSize) => {
            if (childId === ID.SEEK_ID) seekId = readUint(buffer, childStart, childSize);
            if (childId === ID.SEEK_POSITION) position = readUint(buffer, childStart, childSize);
        });
        if (seekId !== null && position !== null && !positions.has(seekId)) positions.set(seekId, position);
    });
    return positions;
}

function parseInfo(buffer) {
    const info = { timestampScale: 1000000, duration: null };
    children(buffer, 0, buffer.length, (id, dataStart, size) => {
        if (id === ID.TIMESTAMP_SCALE) info.timestampScale = readUint(buffer, dataStart, size) || 1000000;
        if (id === ID.DURATION) info.duration = readFloat(buffer, dataStart, size);
    });
    return info;
}

// Whether the video needs a decoder for more than 8 bits, read from the codec's own configuration
function isTenBit(codec, codecPrivate) {
    if (!codecPrivate || codecPrivate.length < 2) return false;
    if (codec === 'h264') return [110, 122, 244].includes(codecPrivate[1]); // High 10, 4:2:2, 4:4:4
    if (codec === 'hevc') return (codecPrivate[1] & 0x1F) >= 2; // Main 10 and the range extensions
    return false;
}

function parseTrack(buffer, start, end) {
    // Matroska's defaults for elements a file leaves out
    const track = { number: null, type: null, codecId: '', name: '', language: 'eng', default: true, width: 0, height: 0, channels: 1, transfer: null, codecPrivate: null };
    let bcp47 = null;
    children(buffer, start, end, (id, dataStart, size) => {
        if (id === ID.TRACK_NUMBER) track.number = readUint(buffer, dataStart, size);
        else if (id === ID.TRACK_TYPE) track.type = readUint(buffer, dataStart, size);
        else if (id === ID.CODEC_ID) track.codecId = readString(buffer, dataStart, size);
        else if (id === ID.CODEC_PRIVATE) track.codecPrivate = buffer.subarray(dataStart, dataStart + Math.min(size, 64));
        else if (id === ID.NAME) track.name = readString(buffer, dataStart, size);
        else if (id === ID.LANGUAGE) track.language = readString(buffer, dataStart, size);
        else if (id === ID.LANGUAGE_BCP47) bcp47 = readString(buffer, dataStart, size);
        else if (id === ID.FLAG_DEFAULT) track.default = readUint(buffer, dataStart, size) === 1;
        else if (id === ID.VIDEO) {
            children(buffer, dataStart, dataStart + size, (videoId, videoStart, videoSize) => {
                if (videoId === ID.PIXEL_WIDTH) track.width = readUint(buffer, videoStart, videoSize);
                if (videoId === ID.PIXEL_HEIGHT) track.height = readUint(buffer, videoStart, videoSize);
                if (videoId === ID.COLOUR) {
                    children(buffer, videoStart, videoStart + videoSize, (colourId, colourStart, colourSize) => {
                        if (colourId === ID.TRANSFER) track.transfer = readUint(buffer, colourStart, colourSize);
                    });
                }
            });
        } else if (id === ID.AUDIO) {
            children(buffer, dataStart, dataStart + size, (audioId, audioStart, audioSize) => {
                if (audioId === ID.CHANNELS) track.channels = readUint(buffer, audioStart, audioSize);
            });
        }
    });
    // The newer language tag wins, e.g. "en-US" becomes "en"
    if (bcp47) track.language = bcp47.split('-')[0];
    return track;
}

function parseTracks(buffer) {
    const tracks = [];
    children(buffer, 0, buffer.length, (id, dataStart, size) => {
        if (id === ID.TRACK_ENTRY) tracks.push(parseTrack(buffer, dataStart, dataStart + size));
    });
    return tracks;
}

// Cue times (in timestamp ticks) that belong to the video track
function parseCues(buffer, videoTrack) {
    const times = [];
    children(buffer, 0, buffer.length, (id, dataStart, size) => {
        if (id !== ID.CUE_POINT) return;
        let time = null;
        let forVideo = videoTrack === null;
        children(buffer, dataStart, dataStart + size, (childId, childStart, childSize) => {
            if (childId === ID.CUE_TIME) time = readUint(buffer, childStart, childSize);
            if (childId === ID.CUE_TRACK_POSITIONS && !forVideo) {
                children(buffer, childStart, childStart + childSize, (positionId, positionStart, positionSize) => {
                    if (positionId === ID.CUE_TRACK && readUint(buffer, positionStart, positionSize) === videoTrack) forVideo = true;
                });
            }
        });
        if (time !== null && forVideo) times.push(time);
    });
    return times;
}

async function readCues(bytesAt, cuesOffset, fileLength, videoTrack, scale) {
    if (cuesOffset === null || cuesOffset >= fileLength) return null;
    const header = readHeader(await bytesAt(cuesOffset, 16), 0);
    if (!header || header.id !== ID.CUES || header.size === null || header.size > MAX_CUES_BYTES) return null;
    const cues = await bytesAt(cuesOffset + header.headerLength, header.size);
    const ticks = parseCues(cues, videoTrack);
    if (!ticks.length) return null;
    return [...new Set(ticks)].sort((a, b) => a - b).map(tick => Math.round(tick * scale * 1e6) / 1e6);
}

/**
 * Reads a Matroska file's header and keyframe index. `read(start, length)` resolves to the bytes at that spot
 * of the file. Resolves to null when the file isn't Matroska, otherwise to
 * { duration, video, audio: [...], keyframes } with times in seconds, the tracks described like utils/media.js
 * describes them, and `keyframes` null when the file has no index of them.
 */
async function readMatroska(read, fileLength) {
    const tailStart = Math.max(0, fileLength - TAIL_BYTES);
    const [head, tail] = await Promise.all([
        read(0, Math.min(HEAD_BYTES, fileLength)),
        tailStart > HEAD_BYTES ? read(tailStart, fileLength - tailStart).catch(() => null) : null
    ]);

    const ebml = readHeader(head, 0);
    if (!ebml || ebml.id !== ID.EBML || ebml.size === null) return null;
    const segmentOffset = ebml.headerLength + ebml.size;
    const segment = readHeader(head, segmentOffset);
    if (!segment || segment.id !== ID.SEGMENT) return null;
    const segmentStart = segmentOffset + segment.headerLength;

    // Bytes of the file starting at `offset`, read again when they aren't in the parts read above
    const bytesAt = async (offset, length) => {
        if (offset + length <= head.length) return head.subarray(offset, offset + length);
        const end = Math.min(offset + length, fileLength);
        if (tail && offset >= tailStart && end <= fileLength) return tail.subarray(offset - tailStart, end - tailStart);
        return read(offset, end - offset);
    };

    let info = { timestampScale: 1000000, duration: null };
    let tracks = [];
    const seeks = new Map();
    let cuesOffset = null;

    // The top level elements before the first cluster: the index (SeekHead), Info and Tracks. Others, like
    // attached fonts, are skipped without reading them.
    let offset = segmentStart;
    while (offset + 2 < fileLength) {
        const header = readHeader(await bytesAt(offset, 16), 0);
        if (!header) break;
        const dataStart = offset + header.headerLength;
        if (header.id === ID.CLUSTER || header.size === null) break;

        if (header.id === ID.CUES) {
            cuesOffset = offset;
            break;
        }
        if ([ID.SEEK_HEAD, ID.INFO, ID.TRACKS].includes(header.id) && header.size <= MAX_HEADER_ELEMENT) {
            const data = await bytesAt(dataStart, header.size);
            if (header.id === ID.SEEK_HEAD) {
                for (const [id, position] of parseSeekHead(data)) {
                    if (!seeks.has(id)) seeks.set(id, position);
                }
            } else if (header.id === ID.INFO) {
                info = parseInfo(data);
            } else {
                tracks = parseTracks(data);
            }
        }
        offset = dataStart + header.size;
    }

    if (cuesOffset === null && seeks.has(ID.CUES)) {
        cuesOffset = segmentStart + seeks.get(ID.CUES);
    }

    // Some files only point at a second SeekHead at the end, which then points at the cues
    if (cuesOffset === null && seeks.has(ID.SEEK_HEAD)) {
        const secondOffset = segmentStart + seeks.get(ID.SEEK_HEAD);
        if (secondOffset < fileLength) {
            const header = readHeader(await bytesAt(secondOffset, 16), 0);
            if (header && header.id === ID.SEEK_HEAD && header.size !== null && header.size <= MAX_HEADER_ELEMENT) {
                const more = parseSeekHead(await bytesAt(secondOffset + header.headerLength, header.size));
                if (more.has(ID.CUES)) cuesOffset = segmentStart + more.get(ID.CUES);
            }
        }
    }

    const scale = info.timestampScale / 1e9;
    const videoTrack = tracks.find(track => track.type === VIDEO_TRACK) || null;
    const audioTracks = tracks.filter(track => track.type === AUDIO_TRACK);
    const keyframes = await readCues(bytesAt, cuesOffset, fileLength, videoTrack ? videoTrack.number : null, scale);

    const videoCodec = videoTrack ? VIDEO_CODECS[videoTrack.codecId] || videoTrack.codecId.toLowerCase() : null;
    return {
        container: 'matroska',
        duration: info.duration ? info.duration * scale : null,
        startTime: 0,
        keyframes,
        video: videoTrack ? {
            codec: videoCodec,
            width: videoTrack.width,
            height: videoTrack.height,
            tenBit: isTenBit(videoCodec, videoTrack.codecPrivate),
            hdr: videoTrack.transfer === 16 || videoTrack.transfer === 18
        } : null,
        audio: audioTracks.map((track, position) => ({
            position,
            codec: track.codecId.startsWith('A_AAC') ? 'aac' : AUDIO_CODECS[track.codecId] || track.codecId.toLowerCase(),
            channels: track.channels,
            language: track.language === 'und' ? '' : track.language,
            title: track.name,
            default: track.default
        }))
    };
}

module.exports = { readMatroska };
