// For rows that scroll sideways inside a page or card that scrolls up and down, like the seasons of a series:
// the mouse wheel scrolls the row too, and the mouse drags it like the movie rows (MovieList.vue). The wheel
// only goes to a row the pointer was moved onto. A row that slides under a pointer that stays put, because the
// page scrolled, lets the wheel go on scrolling the page, and so does a row that's at its end.
// Touch screens, sideways wheels and touchpad swipes scroll the row the browser's own way.

// A press that moves this far sideways drags the row instead of clicking what's under it
const DRAG_THRESHOLD = 5;
// How far the pointer moves after the wheel scrolled the page before the wheel goes to the row under it.
// Less than this is the hand moving the mouse a little while it turns the wheel.
const POINTER_TRAVEL = 6;
// Turns of the wheel this close together are one scroll, which stops at the row's end instead of going on
// with the page
const WHEEL_GAP = 400;
// Pixels per line, for wheels that count in lines (Firefox)
const LINE_HEIGHT = 40;
// Milliseconds to ease toward where the wheel sends the row, and for a flung row to slow down
const WHEEL_EASE = 70;
const GLIDE = 325;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function follow(row) {
    // How far the pointer has moved since the wheel last scrolled the page
    let travel = 0;
    let lastPoint = null;
    // When the row last took a turn of the wheel
    let wheelAt = 0;
    // A sideways turn of the wheel, which the browser scrolls the row with
    let sidewaysEvent = null;
    // { kind: 'wheel', position, target } or { kind: 'glide', position, speed } (px/ms)
    let motion = null;
    let frame = null;
    let frameAt = 0;
    // The mouse button held down on the row: { id, startX, startLeft, moved, stoppedGlide, samples }
    let press = null;
    // Set from letting go of a drag until the click that comes with it
    let blockClick = false;

    const maxScroll = () => Math.max(0, row.scrollWidth - row.clientWidth);

    function stop() {
        if (frame) cancelAnimationFrame(frame);
        frame = null;
        motion = null;
    }

    function animate(next) {
        motion = next;
        if (frame) return;
        frameAt = performance.now();
        frame = requestAnimationFrame(step);
    }

    function step(now) {
        // Something else scrolled the row in the meantime (the component, or a sideways swipe), and that wins
        if (motion.shown !== undefined && Math.abs(row.scrollLeft - motion.shown) > 2) {
            frame = null;
            motion = null;
            return;
        }
        // A tab in the background gets no frames, and shouldn't jump when it's back
        const elapsed = Math.min(50, Math.max(0, now - frameAt));
        frameAt = now;
        const max = maxScroll();
        let done;
        if (motion.kind === 'wheel') {
            motion.position += (motion.target - motion.position) * (1 - Math.exp(-elapsed / WHEEL_EASE));
            done = Math.abs(motion.target - motion.position) < 0.5;
            if (done) motion.position = motion.target;
        } else {
            motion.position += motion.speed * elapsed;
            motion.speed *= Math.exp(-elapsed / GLIDE);
            done = Math.abs(motion.speed) < 0.01 || motion.position <= 0 || motion.position >= max;
        }
        row.scrollLeft = Math.max(0, Math.min(max, motion.position));
        motion.shown = row.scrollLeft;
        if (done) {
            frame = null;
            motion = null;
        } else {
            frame = requestAnimationFrame(step);
        }
    }

    function onWheel(event) {
        // Ctrl and the wheel zoom the page
        if (event.ctrlKey || press) return;
        // Asked for first: Firefox only gives the distances in lines when it's asked for the unit before them
        const mode = event.deltaMode;
        if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) {
            sidewaysEvent = event;
            stop();
            return;
        }

        const max = maxScroll();
        const wheeling = motion && motion.kind === 'wheel';
        const from = wheeling ? motion.target : row.scrollLeft;
        const unit = mode === WheelEvent.DOM_DELTA_LINE ? LINE_HEIGHT : mode === WheelEvent.DOM_DELTA_PAGE ? row.clientWidth : 1;
        const distance = event.deltaY * unit;
        const canMove = distance > 0 ? from < max - 1 : from > 1;
        const now = performance.now();
        const sameScroll = now - wheelAt < WHEEL_GAP;
        // Not cancelable when the page took the start of this scroll: the browser goes on scrolling the page
        if (!event.cancelable || !(sameScroll || (canMove && travel >= POINTER_TRAVEL))) return;

        event.preventDefault();
        wheelAt = now;
        if (!canMove) return;
        const target = Math.max(0, Math.min(max, from + distance));
        if (reducedMotion()) {
            stop();
            row.scrollLeft = target;
        } else {
            animate({ kind: 'wheel', position: wheeling ? motion.position : row.scrollLeft, target });
        }
    }

    // Runs after the row's own listener: a turn of the wheel the row didn't take scrolled the page
    function onAnyWheel(event) {
        if (!event.defaultPrevented && event !== sidewaysEvent) travel = 0;
    }

    function onAnyPointerMove(event) {
        if (event.pointerType !== 'mouse') return;
        if (lastPoint) travel += Math.abs(event.clientX - lastPoint.x) + Math.abs(event.clientY - lastPoint.y);
        lastPoint = { x: event.clientX, y: event.clientY };
    }

    function onPointerDown(event) {
        if (event.pointerType !== 'mouse' || event.button !== 0) return;
        press = {
            id: event.pointerId,
            startX: event.clientX,
            startLeft: row.scrollLeft,
            moved: false,
            // A press that stops a flung row only stops it
            stoppedGlide: !!motion && motion.kind === 'glide',
            samples: []
        };
        stop();
        window.addEventListener('pointermove', onPressMove);
        window.addEventListener('pointerup', onPressEnd);
        window.addEventListener('pointercancel', onPressEnd);
    }

    function onPressMove(event) {
        if (event.pointerId !== press.id) return;
        const walk = event.clientX - press.startX;
        if (!press.moved) {
            if (Math.abs(walk) < DRAG_THRESHOLD) return;
            press.moved = true;
            // Keeps the drag going outside the row, and puts the click that ends it on the row
            try {
                row.setPointerCapture(event.pointerId);
            } catch (err) {
                // The button was let go already
            }
            row.classList.add('dragging');
        }
        row.scrollLeft = press.startLeft - walk;
        const now = performance.now();
        press.samples.push({ time: now, left: row.scrollLeft });
        while (press.samples.length > 2 && now - press.samples[0].time > 100) press.samples.shift();
    }

    function endPress() {
        window.removeEventListener('pointermove', onPressMove);
        window.removeEventListener('pointerup', onPressEnd);
        window.removeEventListener('pointercancel', onPressEnd);
        press = null;
        row.classList.remove('dragging');
    }

    function onPressEnd(event) {
        if (event.pointerId !== press.id) return;
        const { moved, stoppedGlide, samples } = press;
        endPress();
        if (moved || stoppedGlide) {
            // The click follows right away, in the same task
            blockClick = true;
            setTimeout(() => {
                blockClick = false;
            });
        }
        if (!moved || event.type !== 'pointerup' || reducedMotion()) return;

        // Let go while moving, it glides on: from how fast it went in the last moment before
        const now = performance.now();
        const recent = samples.filter(sample => now - sample.time < 100);
        if (recent.length < 2) return;
        const first = recent[0];
        const last = recent[recent.length - 1];
        const speed = (last.left - first.left) / Math.max(1, last.time - first.time);
        if (Math.abs(speed) > 0.1) animate({ kind: 'glide', position: row.scrollLeft, speed: speed * 0.9 });
    }

    // The click that ends a drag, or stops a flung row, isn't meant for what's under the pointer
    function onClick(event) {
        if (!blockClick) return;
        blockClick = false;
        event.preventDefault();
        event.stopPropagation();
    }

    // Dragging a link or a picture would carry it off instead of moving the row
    const onDragStart = event => event.preventDefault();

    row.addEventListener('wheel', onWheel, { passive: false });
    row.addEventListener('pointerdown', onPointerDown);
    row.addEventListener('click', onClick, true);
    row.addEventListener('dragstart', onDragStart);
    window.addEventListener('wheel', onAnyWheel, { passive: true });
    window.addEventListener('pointermove', onAnyPointerMove, { passive: true });

    return () => {
        stop();
        if (press) endPress();
        row.removeEventListener('wheel', onWheel, { passive: false });
        row.removeEventListener('pointerdown', onPointerDown);
        row.removeEventListener('click', onClick, true);
        row.removeEventListener('dragstart', onDragStart);
        window.removeEventListener('wheel', onAnyWheel, { passive: true });
        window.removeEventListener('pointermove', onAnyPointerMove, { passive: true });
    };
}

const detachers = new WeakMap();

// Used as v-side-scroll on the element that scrolls sideways
export const sideScroll = {
    mounted(row) {
        detachers.set(row, follow(row));
    },
    beforeUnmount(row) {
        const detach = detachers.get(row);
        if (detach) detach();
        detachers.delete(row);
    }
};
