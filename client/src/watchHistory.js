import api from './api';

// Progress reports per movie: the request on its way and the newest report waiting for it to finish.
// Only one report per movie is sent at a time, so an older position can never overwrite a newer one.
const saving = new Map(); // IMDb code -> { request, queued: { payload, promise, resolve } | null }

function send(imdbCode, payload) {
    const request = api.put(`/history/${imdbCode}`, payload);
    const entry = { request, queued: null };
    saving.set(imdbCode, entry);

    const next = () => {
        const queued = entry.queued;
        if (queued) {
            queued.resolve(send(imdbCode, queued.payload));
        } else {
            saving.delete(imdbCode);
        }
    };
    request.then(next, next);
    return request;
}

export const watchHistory = {
    // Saves where the viewer is in a movie. Resolves with the server's answer, or rejects when the save failed.
    save(imdbCode, payload) {
        const entry = saving.get(imdbCode);
        if (!entry) return send(imdbCode, payload);

        if (entry.queued) {
            // Only the newest position matters, the watched time of both reports adds up
            const watched = entry.queued.payload.watched + payload.watched;
            entry.queued.payload = { ...payload, watched };
        } else {
            let resolve;
            const promise = new Promise((done) => {
                resolve = done;
            });
            entry.queued = { payload, promise, resolve };
        }
        return entry.queued.promise;
    },

    // Resolves once every save that was started has been answered (or after `timeout`), so a page that
    // lists the history right after the movie was left already gets the latest progress
    settled(timeout = 4000) {
        const wait = async () => {
            while (saving.size) {
                await Promise.allSettled([...saving.values()].map(entry => (entry.queued ? entry.queued.promise : entry.request)));
            }
        };
        return Promise.race([wait(), new Promise(resolve => setTimeout(resolve, timeout))]);
    },

    // Resolves with the removed entry, which `restore` can put back
    async remove(imdbCode) {
        await this.settled();
        const response = await api.delete(`/history/${imdbCode}`);
        return response.data.removed;
    },

    restore(imdbCode, entry) {
        return api.post(`/history/${imdbCode}/restore`, entry);
    }
};
