<template>
    <div class="movie">
        <div class="header">
            <button class="homeButton">
                <router-link :to="'/'">
                    <span>Home</span>
                </router-link>
            </button>

            <div class="search-bar">
                <input v-model="searchQuery" type="text" placeholder="Search for movies..." @keyup.enter="searchMovies" />
                <button @click="searchMovies">Search</button>
            </div>
        </div>

        <div class="movie-details" v-if="movie">
    
            <h1 class="title">{{ movie.title }}</h1>
    
            <div class="torrents" v-if="showTorrents && movie.torrents && movie.torrents.length">
                <button :class="torrent.hash == selectedTorrent && 'selectedTorrent'" v-for="torrent in movie.torrents" :key="torrent.url" @click="selectedTorrent != true && selectTorrent(torrent.hash, false)">{{ torrent?.type }} {{ torrent?.quality }} {{ torrent?.video_codec }}</button>
            </div>
            
            <div class="video-container">
                <video id="movie-player" class="video-js vjs-default-skin" controls>
                    <source v-if="videoSrc" :src="videoSrc" :key="videoSrc" type="video/mp4" />
                    <track v-if="subtitlesEnSrc" :src="subtitlesEnSrc" kind="subtitles" srclang="en" label="English" default />
                    <track v-if="subtitlesBgSrc" :src="subtitlesBgSrc" kind="subtitles" srclang="bg" label="Bulgarian" />
                    Your browser does not support the video tag.
                </video>
                <div v-if="!showTorrents && selectedTorrent && !start" class="overlay" @click="startMovie">
                    <svg class="play-button" width="80" height="80" viewBox="0 0 80 80">
                        <circle cx="40" cy="40" r="38" fill="rgba(0, 0, 0, 0.5)" stroke="white" stroke-width="2" />
                        <polygon points="30,25 55,40 30,55" fill="white" />
                    </svg>
                </div>
                <div v-if="showTorrents && selectedTorrent && !start" class="overlay" @click="startMovie">Select Resolution</div>
                <div v-if="selectedTorrent && start && !isVideoLoaded" class="overlay loading">
                    <div class="spinner"></div>
                </div>
                
                <!-- Subtitle settings modal -->
                <div v-if="showSubtitleSettings" class="subtitle-settings-modal" @click.self="showSubtitleSettings = false">
                    <div class="subtitle-settings-container">
                        <h3>Subtitle Settings</h3>
                        <div class="setting-group">
                            <label>Font Size</label>
                            <div class="setting-controls">
                                <button @click="changeFontSize(-0.1)">-</button>
                                <span>{{ (subtitleSettings.fontSize * 100).toFixed(0) }}%</span>
                                <button @click="changeFontSize(0.1)">+</button>
                            </div>
                        </div>
                        
                        <div class="setting-group">
                            <label>Background Opacity</label>
                            <div class="setting-controls">
                                <button @click="changeBackgroundOpacity(-0.1)">-</button>
                                <span>{{ (subtitleSettings.bgOpacity * 100).toFixed(0) }}%</span>
                                <button @click="changeBackgroundOpacity(0.1)">+</button>
                            </div>
                        </div>
                        
                        <div class="setting-group">
                            <label>Text Color</label>
                            <div class="color-options">
                                <span 
                                    v-for="color in colors" 
                                    :key="color" 
                                    :style="{ backgroundColor: color }" 
                                    class="color-option"
                                    :class="{ active: subtitleSettings.color === color }"
                                    @click="subtitleSettings.color = color; applySubtitleSettings()"
                                ></span>
                            </div>
                        </div>
                        
                        <button class="close-btn" @click="showSubtitleSettings = false">Close</button>
                    </div>
                </div>
            </div>
            
            <!-- Subtitle settings button -->
            <button v-if="selectedTorrent" class="subtitle-settings-btn" @click="showSubtitleSettings = true">
                Subtitle Settings
            </button>
    
            <div class="movie-info">
                <p class="rating"><img width="24" height="24" src="https://img.icons8.com/fluency/24/star--v1.png" alt="star--v1"/> {{ movie.rating }} / 10</p>
                <a :href="'https://www.imdb.com/title/' + movie.imdb_code" target="_blank" class="imdb-button">
                    <img src="https://upload.wikimedia.org/wikipedia/commons/6/69/IMDB_Logo_2016.svg" alt="IMDB">
                </a>
            </div>
            
            <p class="year">Year: {{ movie.year }}</p>
            <p class="genres">Genres: {{ movie.genres.join(', ') }}</p>

            <div class="summary">
                <h2>Summary</h2>
                <p>{{ movie.summary || "No summary available" }}</p>
            </div>

            <button class="resetMovie" @click="resetMovie()">Reset</button>
        </div>
    </div>
</template>

<script>
import axios from 'axios';
import Plyr from 'plyr';
import 'plyr/dist/plyr.css';
import 'plyr/dist/plyr.polyfilled.js';

const URL = process.env.VUE_APP_BACKEND_URL || 'http://localhost:8080';

export default {
    name: 'MoviePage',
    data() {
        return {
            movie: null,
            selectedTorrent: null,
            start: false,
            showTorrents: false,
            isVideoLoaded: false,
            URL: URL,
            player: null,
            loadError: null,
            searchQuery: '',
            keyboardListener: null,
            showSubtitleSettings: false,
            subtitleSettings: {
                fontSize: 1.0,       // multiplier for default size
                bgOpacity: 0.5,      // background opacity 0-1
                color: '#ffffff'     // text color
            },
            colors: ['#ffffff', '#ffff00', '#00ff00', '#00ffff', '#ff00ff']
        };
    },
    computed: {
        videoSrc() {
            return this.start ? `${URL}/stream/${this.movie.imdb_code}/${this.selectedTorrent}` : '';
        },
        subtitlesEnSrc() {
            return this.start && this.movie ? `/subtitles/${this.movie.imdb_code}?lang=en` : '';
        },
        subtitlesBgSrc() {
            return this.start && this.movie ? `/subtitles/${this.movie.imdb_code}?lang=bg` : '';
        },
        isMobile() {
            return window.innerWidth < 768;
        }
    },
    mounted() {
        const imdbCode = this.$route.params.imdb_code;
        axios.get(URL + `/movies/${imdbCode}`, {
            headers: {
                Authorization: localStorage.getItem('token')
            }
        })
        .then(async response => {
            this.movie = response.data.movie;
            const bestTorrent = response.data.movie.torrents.find(torrent => torrent.quality == '1080p' && torrent.video_codec == 'x264') || response.data.movie.torrents.find(torrent => torrent.quality == "1080p") || response.data.movie.torrents[0];
            
            await this.selectTorrent(bestTorrent.hash);
        }).catch(error => {
            console.error('There was an error!', error);
        });

        // Add global keyboard controls
        this.keyboardListener = (e) => {
            if (!this.player) return;
            
            switch(e.code) {
                case 'Space':
                    e.preventDefault();
                    this.player.togglePlay(this.player.playing);
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    break;
                case 'ArrowUp': {
                    e.preventDefault();
                    const newVolume = Math.min(1, this.player.volume + 0.1);
                    this.player.volume = newVolume;
                    break;
                }
                case 'ArrowDown': {
                    e.preventDefault();
                    const newVol = Math.max(0, this.player.volume - 0.1);
                    this.player.volume = newVol;
                    break;
                }
            }
        };
        
        document.addEventListener('keydown', this.keyboardListener);
    },
    watch: {
        movie(newVal) {
            if (newVal) {
                this.$nextTick(() => {
                    const videoElement = document.getElementById('movie-player');
                    if (videoElement) {
                        if (!this.isMobile) {
                            this.loadSavedSubtitleSettings();
                            
                            this.player = new Plyr(videoElement, {
                                keyboard: { focused: false, global: true },
                                captions: { active: true, update: true },
                                controls: [
                                    'play-large', 
                                    'rewind', 
                                    'play', 
                                    'fast-forward', 
                                    'progress', 
                                    'current-time', 
                                    'duration', 
                                    'mute', 
                                    'volume', 
                                    'captions', 
                                    'settings', 
                                    'fullscreen' 
                                ],
                                seekTime: 10,
                                settings: ['captions', 'quality', 'speed']
                            });

                            // Apply custom styles
                            this.applySubtitleSettings();

                            // Set event listeners on the underlying video element
                            videoElement.addEventListener('playing', () => {
                                this.isVideoLoaded = true;
                            });
                            videoElement.addEventListener('error', (event) => {
                                console.error('Video error:', event);
                                this.loadError = 'Failed to load video';
                                this.isVideoLoaded = false;
                            });
                        } else {
                            // For mobile, use the native video element
                            videoElement.addEventListener('playing', () => {
                                this.isVideoLoaded = true;
                            });
                            videoElement.addEventListener('error', (event) => {
                                console.error('Video error:', event);
                                this.loadError = 'Failed to load video';
                                this.isVideoLoaded = false;
                            });
                        }
                    }
                });
            }
        }
    },
    methods: {
        startMovie() {
            this.start = true;
            if (!this.isMobile) {
                if (this.player) {
                    this.player.pause();
                    // Update source using Plyr API
                    this.player.source = {
                        type: 'video',
                        sources: [
                            {
                                src: this.videoSrc,
                                type: 'video/mp4'
                            }
                        ],
                        tracks: [
                            {
                                kind: 'subtitles',
                                label: 'English',
                                srclang: 'en',
                                src: this.subtitlesEnSrc,
                            },
                            {
                                kind: 'subtitles',
                                label: 'Bulgarian',
                                srclang: 'bg',
                                src: this.subtitlesBgSrc
                            }
                        ]
                    };

                    this.player.play().then(() => {
                        this.isVideoLoaded = true;
                    }).catch(error => {
                        console.error('Error playing video:', error);
                    });

                    this.player.on('ready', () => {
                        this.player.toggleCaptions(true);
                        this.applySubtitleSettings();
                    });
                }
            } else {
                const videoElement = document.getElementById('movie-player');
                if (videoElement) {
                    const sourceElement = videoElement.querySelector('source');
                    if (sourceElement) {
                        sourceElement.setAttribute('src', this.videoSrc);
                    }
                    videoElement.load();
                    videoElement.play().then(() => {
                        this.isVideoLoaded = true;
                    }).catch(error => {
                        console.error('Error playing video:', error);
                    });
                }
            }
        },
        async selectTorrent(torrentHash, preload = true) {
            this.selectedTorrent = torrentHash;
            this.isVideoLoaded = false;
            this.loadError = null;
            this.start = false;

            if(!preload) {
                this.startMovie();
                return;
            }

            try {
                await axios.get(URL+"/preload/" + this.movie.imdb_code + "/" + torrentHash);
            } catch (error) {
                this.showTorrents = true;
                console.error('Error selecting torrent:', error);
            }
        },
        searchMovies() {
            if (this.searchQuery.trim() !== '') {
                this.$router.push({ path: '/search', query: { query: this.searchQuery } });
            }
        },
        async resetMovie() {
            // Ask if user is sure
            if(!confirm('Are you sure you want to reset the movie? \nThis will reset the movie information and torrents.')) {
                return;
            }

            try {
                const response = await axios.post(URL + '/reset-movie', {
                    imdb_code: this.movie.imdb_code
                }, {
                    headers: {
                        Authorization: localStorage.getItem('token')
                    }
                });

                alert(response.data.message || 'Movie reset successfully!');
                window.location.reload();
            } catch (error) {
                alert(`There was an error! \n${error.response.data.message || error.response.data || 'An error occurred'}`);
            }
        },
        changeFontSize(delta) {
            this.subtitleSettings.fontSize = Math.max(0.5, Math.min(2.0, this.subtitleSettings.fontSize + delta));
            this.applySubtitleSettings();
        },
        
        changeBackgroundOpacity(delta) {
            this.subtitleSettings.bgOpacity = Math.max(0, Math.min(1, this.subtitleSettings.bgOpacity + delta));
            this.applySubtitleSettings();
        },
        
        applySubtitleSettings() {
            if (!this.player) return;
            
            // Save settings to localStorage
            localStorage.setItem('subtitleSettings', JSON.stringify(this.subtitleSettings));
            
            // Apply settings through CSS
            const fontSize = this.subtitleSettings.fontSize * 1.8; // Base size is 1.8rem
            const bgOpacity = this.subtitleSettings.bgOpacity;
            const color = this.subtitleSettings.color;
            
            const styleEl = document.getElementById('plyr-subtitle-styles') || document.createElement('style');
            styleEl.id = 'plyr-subtitle-styles';
            styleEl.innerHTML = `
                .plyr__captions {
                    font-size: ${fontSize}rem !important;
                    color: ${color} !important;
                    text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.7) !important;
                }
                .plyr__captions span {
                    background-color: rgba(0, 0, 0, ${bgOpacity}) !important;
                    padding: 2px 8px !important;
                }
            `;
            
            if (!document.getElementById('plyr-subtitle-styles')) {
                document.head.appendChild(styleEl);
            }
        },
        
        loadSavedSubtitleSettings() {
            const savedSettings = localStorage.getItem('subtitleSettings');
            if (savedSettings) {
                try {
                    this.subtitleSettings = JSON.parse(savedSettings);
                } catch (e) {
                    console.error('Error parsing saved subtitle settings', e);
                }
            }
        }
    },
    created() {
        this.loadSavedSubtitleSettings();
    },
    beforeUnmount() {
        if (this.player) {
            // Use Plyr's destroy method
            this.player.destroy();
        }
        // Remove keyboard listener
        if (this.keyboardListener) {
            document.removeEventListener('keydown', this.keyboardListener);
        }
    }
};
</script>

<style scoped>
@import 'video.js/dist/video-js.css';

.movie {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-height: 100dvh;
    align-items: center;
}

.header {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    width: 100%;
    max-width: 800px;
    margin: 0 auto;
}

.homeButton {
    margin: 24px 0px;
    border: none;
    background-color: #333;
    padding: 10px 20px;
    border-radius: 5px;
    cursor: pointer;
    transition: background-color 0.3s ease;
}

.homeButton span {
    color: #fff;
    font-size: 1.1rem;
}

.homeButton:hover {
    background-color: #555;
}

.search-bar {
    margin: auto 0;
}

.search-bar input {
    padding: 10px;
    font-size: 16px;
    width: 300px;
    margin-right: 10px;
}

.search-bar button {
    padding: 10px 20px;
    font-size: 16px;
    cursor: pointer;
}

.movie-details {
    width: calc(100% - 40px);
    padding: 0 20px;
    max-width: 840px;
    flex-grow: 1;
    margin: 0 auto;
    background-color: #111;
}

.torrents {
    width: calc(100% - 4px);
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: start;
    background-color: #222;
    height: fit-content;
    border-top-left-radius: 24px;
    border-top-right-radius: 24px;
    overflow-x: hidden;
    border: solid 2px black;
}

.torrents > button {
    padding-left: 12px;
    padding-right: 12px;
    font-size: 1.3rem;
    border: none;
    border: solid 1px black;
    height: 48px;
    flex-grow: 1;
}

.selectedTorrent {
    background-color: #333;
}

.movie {
    width: 100%;
}

.title {
    margin-top: 24px;
}

.video-container {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
}

.video-js {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
}

.overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.7);
    color: white;
    font-size: 1.5em;
    z-index: 10;
}

.play-button {
    cursor: pointer;
}

.loading .spinner {
    border: 4px solid rgba(255, 255, 255, 0.3);
    border-radius: 50%;
    border-top: 4px solid white;
    width: 40px;
    height: 40px;
    animation: spin 1s linear infinite;
}

.movie-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 24px;
    margin-bottom: 24px;
}

.imdb-button {
    background-color: #f5c518;
    padding: 4px 8px;
    border-radius: 4px;
    margin-right: 6px;
    display: flex;
    align-items: center;
    transition: all 0.3s ease;
}

.imdb-button:hover {
    filter: brightness(0.8);
}

.imdb-button img {
    height: 24px;
    width: auto;
}

/* Update existing rating style to work with new layout */
.rating {
    margin: 0;
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 3px;
    font-size: 1.3rem;
}

.year, .genres {
    font-size: 1.2rem;
    margin-bottom: 6px;
}

.genres {
    margin-top: 0;
}

.summary {
    margin-top: 24px;
}

.summary > h2 {
    margin-bottom: 0;
}

.summary > p {
    margin-top: 8px;
    line-height: 1.5rem;
}

.resetMovie {
    margin: 48px 0;
    padding: 10px 20px;
    font-size: 1.1rem;
    color: white;
    background-color: #d9534f;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    transition: background-color 0.3s ease;
}

.resetMovie:hover {
    background-color: #c9302c;
}

@keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}

.subtitle-settings-btn {
    margin-top: 10px;
    padding: 8px 16px;
    background-color: #333;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
}

.subtitle-settings-btn:hover {
    background-color: #444;
}

.subtitle-settings-modal {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.7);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
}

.subtitle-settings-container {
    background-color: #222;
    border-radius: 8px;
    padding: 20px;
    width: 90%;
    max-width: 400px;
}

.subtitle-settings-container h3 {
    margin-top: 0;
    text-align: center;
    margin-bottom: 20px;
}

.setting-group {
    margin-bottom: 20px;
}

.setting-group label {
    display: block;
    margin-bottom: 8px;
    font-weight: bold;
}

.setting-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
}

.setting-controls button {
    width: 40px;
    height: 40px;
    font-size: 18px;
    background-color: #444;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
}

.color-options {
    display: flex;
    justify-content: space-between;
}

.color-option {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    cursor: pointer;
    border: 2px solid transparent;
}

.color-option.active {
    border-color: #fff;
    box-shadow: 0 0 5px rgba(255, 255, 255, 0.8);
}

.close-btn {
    display: block;
    width: 100%;
    padding: 10px;
    background-color: #444;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    margin-top: 10px;
}
</style>
