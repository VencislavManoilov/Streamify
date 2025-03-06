<template>
    <div class="movie-details" v-if="movie">
        <h1>{{ movie.title }}</h1>
        <!-- <img :src="movie.large_cover_image" :alt="movie.title" class="movie-image" /> -->
        <p>Rating: {{ movie.rating }}</p>
        <p>Genres: {{ movie.genres.join(', ') }}</p>
        <div v-if="movie.torrents && movie.torrents.length">
            <div v-for="torrent in movie.torrents" :key="torrent.url">
                <button @click="selectTorrent(torrent.hash)">{{ torrent?.type }} {{ torrent?.quality }} {{ torrent?.video_codec }}</button>
            </div>
        </div>
        <div class="video-container">
            <video id="movie-player" class="video-js vjs-default-skin" controls>
                <source v-if="videoSrc" :src="videoSrc" type="video/mp4" />
                Your browser does not support the video tag.
            </video>
            <div v-if="!selectedTorrent" class="overlay">Select Resolution</div>
            <div v-if="selectedTorrent && !isVideoLoaded" class="overlay loading">
                <div class="spinner"></div>
            </div>
        </div>
    </div>
</template>

<script>
import axios from 'axios';
import videojs from 'video.js';
import 'video.js/dist/video-js.css';

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
            loadError: null
        };
    },
    computed: {
        videoSrc() {
            return this.selectedTorrent ? `${URL}/stream/${this.movie.imdb_code}/${this.selectedTorrent}` : '';
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
        // Initialize video.js after movie is loaded and the video element is rendered
        movie(newVal) {
            if (newVal) {
                this.$nextTick(() => {
                    const videoElement = document.getElementById('movie-player');
                    if (videoElement) {
                        this.player = videojs(videoElement, {
                            language: 'en', // explicitly set locale
                            playbackRates: [0.5, 1, 1.5, 2],
                            controlBar: {
                                skipButtons: {
                                    forward: 10,
                                    backward: 10
                                }
                            }
                        });
                        
                        // Video.js event listeners
                        this.player.on('loadeddata', () => {
                            console.log('Video data loaded');
                            this.isVideoLoaded = true;
                        });
                        
                        this.player.on('canplay', () => {
                            console.log('Video can play now');
                            this.isVideoLoaded = true;
                        });
                        
                        this.player.on('playing', () => {
                            console.log('Video is playing');
                            this.isVideoLoaded = true;
                        });
                        
                        this.player.on('error', () => {
                            console.error('Video error:', this.player.error());
                            this.loadError = 'Failed to load video';
                            this.isVideoLoaded = false;
                        });
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

            if (this.player) {
                console.log('Setting new source:', this.videoSrc);
                this.player.pause();
                this.player.src({
                    type: 'video/mp4',
                    src: this.videoSrc
                });
                this.player.load();
                setTimeout(() => {
                    if (!this.isVideoLoaded) {
                        console.log('Attempting to force play');
                        this.player.play()
                            .then(() => {
                                console.log('Playback started');
                                this.isVideoLoaded = true;
                            })
                            .catch(error => {
                                console.error('Error playing video:', error);
                            });
                    }
                }, 3000);
            }
        }
    },
    beforeUnmount() {
        if (this.player) {
            this.player.dispose();
        }
    }
};
</script>

<style scoped>
@import 'video.js/dist/video-js.css';

.movie-details {
    padding: 20px;
}

.movie {
    max-width: 100%;
}

.video-container {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    margin-top: 24px;
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

@keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}
</style>