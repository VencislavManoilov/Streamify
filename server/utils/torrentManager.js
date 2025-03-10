class TorrentManager {
    constructor(torrentClient) {
        this.torrentClient = torrentClient;
        this.activeTorrents = new Map(); // Map torrent hash to {torrent, refCount, lastAccessed}
        this.pendingTorrents = new Map(); // Track torrents currently being added
        
        // Configuration options
        this.torrentOptions = {
            maxWebConns: 20,        // Max web seed connections
            skipVerify: false,      // Safety first, verify data
            destroyStoreOnDestroy: true  // Clean up resources when removing torrents
        };
        
        this.addTimeout = 60000;    // 60 seconds timeout for adding torrents
        this.idleTimeout = 15 * 60 * 1000; // 15 minutes
        this.cleanupInterval = 5 * 60 * 1000; // 5 minutes
        
        // Auto cleanup
        this.cleanupTimer = setInterval(() => this.cleanupIdleTorrents(), this.cleanupInterval);
    }

    async getTorrent(torrentUrl, torrentHash) {
        // Check if we already have this torrent
        if (this.activeTorrents.has(torrentHash)) {
            const torrentEntry = this.activeTorrents.get(torrentHash);
            torrentEntry.refCount++;
            torrentEntry.lastAccessed = Date.now();
            return torrentEntry.torrent;
        }
        
        // Check if this torrent is currently being added
        if (this.pendingTorrents.has(torrentHash)) {
            try {
                return await this.pendingTorrents.get(torrentHash);
            } catch (err) {
                // If the pending torrent failed, try again
                this.pendingTorrents.delete(torrentHash);
            }
        }
        
        // Create a new promise for adding this torrent
        const torrentPromise = new Promise((resolve, reject) => {
            const addTimeout = setTimeout(() => {
                reject(new Error("Timeout adding torrent"));
            }, this.addTimeout);
            
            try {
                this.torrentClient.add(torrentUrl, this.torrentOptions, torrent => {
                    clearTimeout(addTimeout);
                    
                    // Optimize downloading strategy
                    torrent.on('ready', () => {
                        torrent.select(0, torrent.pieces.length - 1, 0); // Start with low priority
                    });
                    
                    // Save to activeTorrents map
                    this.activeTorrents.set(torrentHash, {
                        torrent,
                        refCount: 1,
                        lastAccessed: Date.now()
                    });
                    
                    resolve(torrent);
                    this.pendingTorrents.delete(torrentHash);
                });
            } catch (err) {
                clearTimeout(addTimeout);
                reject(err);
                this.pendingTorrents.delete(torrentHash);
            }
            
            // Handle client-level errors
            const errorHandler = (err) => {
                clearTimeout(addTimeout);
                reject(err);
                this.pendingTorrents.delete(torrentHash);
                this.torrentClient.removeListener('error', errorHandler);
            };
            
            this.torrentClient.once('error', errorHandler);
        });
        
        // Store the promise so concurrent requests can await the same operation
        this.pendingTorrents.set(torrentHash, torrentPromise);
        
        try {
            return await torrentPromise;
        } catch (error) {
            console.error(`Failed to add torrent ${torrentHash}:`, error);
            throw error;
        }
    }

    releaseReference(torrentHash) {
        if (!this.activeTorrents.has(torrentHash)) return;
        
        const torrentEntry = this.activeTorrents.get(torrentHash);
        torrentEntry.refCount--;
        torrentEntry.lastAccessed = Date.now();
        
        // If no references, mark for potential cleanup but don't remove immediately
        // Keeping it for a while improves performance if requested again soon
    }

    removeTorrent(torrentHash) {
        if (!this.activeTorrents.has(torrentHash)) return;
        
        const torrentEntry = this.activeTorrents.get(torrentHash);
        try {
            if (this.torrentClient.get(torrentEntry.torrent.infoHash)) {
                // Destroy and remove to free up resources
                torrentEntry.torrent.destroy({ destroyStore: this.torrentOptions.destroyStoreOnDestroy });
                this.torrentClient.remove(torrentEntry.torrent.infoHash);
            }
        } catch (err) {
            console.error(`Error removing torrent ${torrentHash}:`, err);
        } finally {
            this.activeTorrents.delete(torrentHash);
        }
    }

    // Run this periodically to clean up unused torrents
    cleanupIdleTorrents() {
        const now = Date.now();
        for (const [hash, entry] of this.activeTorrents.entries()) {
            if (entry.refCount <= 0 && now - entry.lastAccessed > this.idleTimeout) {
                console.log(`Cleaning up idle torrent: ${hash}`);
                this.removeTorrent(hash);
            }
        }
    }
    
    // Call this when shutting down the application
    shutdown() {
        clearInterval(this.cleanupTimer);
        
        // Clean up all torrents
        for (const hash of this.activeTorrents.keys()) {
            this.removeTorrent(hash);
        }
    }
    
    // Get statistics about active torrents
    getStats() {
        return {
            activeTorrents: this.activeTorrents.size,
            pendingTorrents: this.pendingTorrents.size,
            details: Array.from(this.activeTorrents.entries()).map(([hash, entry]) => ({
                hash,
                refCount: entry.refCount,
                idleTime: Date.now() - entry.lastAccessed,
                downloadSpeed: entry.torrent.downloadSpeed,
                progress: Math.round(entry.torrent.progress * 100)
            }))
        };
    }
}

module.exports = TorrentManager;