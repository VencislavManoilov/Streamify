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
    
            <div class="torrents" v-if="movie.torrents && movie.torrents.length">
                <button :class="torrent.hash == selectedTorrent && 'selectedTorrent'" v-for="torrent in movie.torrents" :key="torrent.url" @click="selectedTorrent != true && selectTorrent(torrent.hash)">{{ torrent?.type }} {{ torrent?.quality }} {{ torrent?.video_codec }}</button>
            </div>
            
            <div class="video-container">
                <video id="movie-player" class="video-js vjs-default-skin" controls>
                    <source v-if="videoSrc" :src="videoSrc" :key="videoSrc" type="video/mp4" />
                    <!-- <track :src="subtitesSrc" kind="subtitles" srclang="bg" label="Bulgarian" /> -->
                    <track v-if="subtitesSrc" :src="subtitesSrc" kind="subtitles" srclang="en" label="English" default />
                    Your browser does not support the video tag.
                </video>
                <div v-if="!selectedTorrent" class="overlay">Select Resolution</div>
                <div v-if="selectedTorrent && !isVideoLoaded" class="overlay loading">
                    <div class="spinner"></div>
                </div>
            </div>
    
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
            isVideoLoaded: false,
            URL: URL,
            player: null,
            loadError: null,
            searchQuery: '',
        };
    },
    computed: {
        videoSrc() {
            return this.selectedTorrent ? `${URL}/stream/${this.movie.imdb_code}/${this.selectedTorrent}` : '';
        },
        subtitesSrc() {
            return this.selectedTorrent ? `/captions/${this.movie.imdb_code}/${this.selectedTorrent}` : '';
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
        .then(response => {
            this.movie = response.data.movie;
        }).catch(error => {
            console.error('There was an error!', error);
        });
    },
    watch: {
        movie(newVal) {
            if (newVal) {
                this.$nextTick(() => {
                    const videoElement = document.getElementById('movie-player');
                    if (videoElement) {
                        if (!this.isMobile) {
                            this.player = new Plyr(videoElement, {
                                captions: { active: true, update: true },
                                controls: [
                                    'play-large', // The large play button in the center
                                    'rewind', // Rewind by 10 seconds
                                    'play', // Play/pause playback
                                    'fast-forward', // Fast forward by 10 seconds
                                    'progress', // The progress bar and scrubber
                                    'current-time', // The current time display
                                    'duration', // The full duration display
                                    'mute', // Toggle mute
                                    'volume', // Volume control
                                    'captions', // Toggle captions
                                    'settings', // Settings menu
                                    'fullscreen' // Toggle fullscreen
                                ],
                                seekTime: 10, // Set the seek time to 10 seconds for forward/backward skips
                            });
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
        selectTorrent(torrentHash) {
            this.selectedTorrent = torrentHash;
            this.isVideoLoaded = false;
            this.loadError = null;
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
                                src: this.subtitesSrc,
                                default: true
                            }
                        ]
                    };

                    this.player.play().then(() => {
                        this.isVideoLoaded = true;
                    }).catch(error => {
                        console.error('Error playing video:', error);
                    });

                    this.player.on('ready', () => {
                        const track = this.player.elements.container.querySelector('track');
                        if (track) {
                            track.mode = 'showing';
                        }
                        this.player.toggleCaptions(true);
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
        }
    },
    beforeUnmount() {
        if (this.player) {
            // Use Plyr's destroy method
            this.player.destroy();
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
</style>