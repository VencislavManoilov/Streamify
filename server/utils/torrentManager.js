const logger = require('../utils/logger');

class TorrentManager {
    constructor(torrentClient) {
        this.torrentClient = torrentClient;
        this.activeTorrents = new Map(); // Map torrent hash to {torrent, refCount, lastAccessed}
        this.timeForCleanup = 30 * 60 * 1000; // 30 minutes - pretty generous for cleanup
    }

    async getTorrent(torrentUrl, torrentHash) {
        // Check if we already have this torrent in our manager
        if (this.activeTorrents.has(torrentHash)) {
            const torrentEntry = this.activeTorrents.get(torrentHash);
            torrentEntry.refCount++;
            torrentEntry.lastAccessed = Date.now();
            return torrentEntry.torrent;
        }

        // Check if the torrent is already in the client but not in our manager
        const existingTorrent = this.torrentClient.torrents.find(t => 
            t.infoHash === torrentHash || t.infoHash === torrentHash.toLowerCase()
        );

        if (existingTorrent) {
            // Track the existing torrent in our manager
            this.activeTorrents.set(torrentHash, {
                torrent: existingTorrent,
                refCount: 1,
                lastAccessed: Date.now()
            });
            return existingTorrent;
        }

        // Add new torrent
        try {
            const torrent = await new Promise((resolve, reject) => {
                const addOpts = { skipVerify: false };
                
                const onTorrent = (torrent) => {
                    clearTimeout(timeout);
                    resolve(torrent);
                };
                
                let torrentHandle;
                try {
                    torrentHandle = this.torrentClient.add(torrentUrl, addOpts, onTorrent);
                } catch (err) {
                    // If it's a duplicate error, try to find and return the existing torrent
                    if (err.message && err.message.includes('duplicate')) {
                        const dupeHash = err.message.split('duplicate torrent ')[1];
                        const existingTorrent = this.torrentClient.get(dupeHash);
                        if (existingTorrent) return resolve(existingTorrent);
                    }
                    return reject(err);
                }
                
                // Set timeout for adding torrent to prevent hanging
                const timeout = setTimeout(() => {
                    if (torrentHandle && !torrentHandle.destroyed) {
                        this.torrentClient.remove(torrentHandle);
                    }
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
        } catch (err) {
            logger.error("Error adding torrent:" + err);
            
            // If it's a duplicate torrent error, try to get the existing torrent
            if (err.message && err.message.includes('duplicate torrent')) {
                const match = err.message.match(/duplicate torrent ([0-9a-f]+)/i);
                if (match && match[1]) {
                    const dupeHash = match[1];
                    const existingTorrent = this.torrentClient.get(dupeHash);
                    
                    if (existingTorrent) {
                        this.activeTorrents.set(torrentHash, {
                            torrent: existingTorrent,
                            refCount: 1,
                            lastAccessed: Date.now()
                        });
                        return existingTorrent;
                    }
                }
            }
            
            throw err;
        }
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
            if (entry.refCount <= 0 && now - entry.lastAccessed > this.timeForCleanup) {
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