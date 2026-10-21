import api from './api';

// Progress reports per movie or episode: the request on its way and the newest report waiting for it to
// finish. Only one report per video is sent at a time, so an older position can never overwrite a newer one.
const saving = new Map(); // address -> { request, queued: { payload, promise, resolve } | null }

function send(path, payload) {
    const request = api.put(path, payload);
    const entry = { request, queued: null };
    saving.set(path, entry);

    const next = () => {
        const queued = entry.queued;
        if (queued) {
            queued.resolve(send(path, queued.payload));
        } else {
            saving.delete(path);
        }
    };
    request.then(next, next);
    return request;
}

function queue(path, payload) {
    const entry = saving.get(path);
    if (!entry) return send(path, payload);

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
}

// Where a navigator.sendBeacon() of an episode's progress goes
export function episodeHistoryPath(imdbCode, season, episode) {
    return `/history/series/${imdbCode}/${season}/${episode}`;
}

export const watchHistory = {
    // Saves where the viewer is in a movie. Resolves with the server's answer, or rejects when the save failed.
    save(imdbCode, payload) {
        return queue(`/history/${imdbCode}`, payload);
    },

    // The same for an episode of a series
    saveEpisode(imdbCode, season, episode, payload) {
        return queue(episodeHistoryPath(imdbCode, season, episode), payload);
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
    },

    // Takes a whole series off the history. Resolves with its removed episodes, which `restoreSeries` puts back.
    async removeSeries(imdbCode) {
        await this.settled();
        const response = await api.delete(`/history/series/${imdbCode}`);
        return response.data.removed;
    },

    restoreSeries(imdbCode, episodes) {
        return api.post(`/history/series/${imdbCode}/restore`, { episodes });
    }
};
