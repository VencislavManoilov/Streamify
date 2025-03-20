class TorrentManager {
    constructor(torrentClient) {
        this.torrentClient = torrentClient;
        this.activeTorrents = new Map(); // Map torrent hash to {torrent, refCount, lastAccessed}
    }

    async getTorrent(torrentUrl, torrentHash) {
        // Check if we already have this torrent
        if (this.activeTorrents.has(torrentHash)) {
            const torrentEntry = this.activeTorrents.get(torrentHash);
            torrentEntry.refCount++;
            torrentEntry.lastAccessed = Date.now();
            return torrentEntry.torrent;
        }

        // Add new torrent
        const torrent = await new Promise((resolve, reject) => {
            this.torrentClient.add(torrentUrl, { skipVerify: false }, torrent => {
                resolve(torrent);
            });
            
            // Set timeout for adding torrent to prevent hanging
            const timeout = setTimeout(() => {
                reject(new Error("Timed out adding torrent"));
            }, 30000);
            
            this.torrentClient.once('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });
        });

        // Store the torrent with reference count
        this.activeTorrents.set(torrentHash, {
            torrent,
            refCount: 1,
            lastAccessed: Date.now()
        });

        return torrent;
    }

    releaseReference(torrentHash) {
        if (!this.activeTorrents.has(torrentHash)) return;
        
        const torrentEntry = this.activeTorrents.get(torrentHash);
        torrentEntry.refCount--;
        
        // If no references and it's been more than 5 minutes since last access, remove it
        if (torrentEntry.refCount <= 0 && 
            Date.now() - torrentEntry.lastAccessed > 5 * 60 * 1000) {
            this.removeTorrent(torrentHash);
        }
    }

    removeTorrent(torrentHash) {
        if (!this.activeTorrents.has(torrentHash)) return;
        
        const torrentEntry = this.activeTorrents.get(torrentHash);
        if (this.torrentClient.get(torrentEntry.torrent.infoHash)) {
            this.torrentClient.remove(torrentEntry.torrent.infoHash);
        }
        
        this.activeTorrents.delete(torrentHash);
    }

    // Run this periodically to clean up unused torrents
    cleanupIdleTorrents() {
        const now = Date.now();
        for (const [hash, entry] of this.activeTorrents.entries()) {
            if (entry.refCount <= 0 && now - entry.lastAccessed > 15 * 60 * 1000) {
                this.removeTorrent(hash);
            }
        }
    }

    getStats() {
        let totalTorrents = 0;
        let torrentsWithReferences = 0;
        let idleTorrents = 0;

        for (const entry of this.activeTorrents.values()) {
            totalTorrents++;
            if (entry.refCount > 0) {
                torrentsWithReferences++;
            } else {
                idleTorrents++;
            }
        }

        return {
            totalTorrents,
            torrentsWithReferences,
            idleTorrents
        };
    }
}

module.exports = TorrentManager;