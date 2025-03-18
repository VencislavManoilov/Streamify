<template>
    <div class="container" @click.self="$emit('close')">
        <div class="movie-details">
            <button class="closeButton" v-on:click="$emit('close')">
                <svg class="closeSvg" viewBox="0 0 122.878 122.88" enable-background="new 0 0 122.878 122.88"><g><path d="M1.426,8.313c-1.901-1.901-1.901-4.984,0-6.886c1.901-1.902,4.984-1.902,6.886,0l53.127,53.127l53.127-53.127 c1.901-1.902,4.984-1.902,6.887,0c1.901,1.901,1.901,4.985,0,6.886L68.324,61.439l53.128,53.128c1.901,1.901,1.901,4.984,0,6.886 c-1.902,1.902-4.985,1.902-6.887,0L61.438,68.326L8.312,121.453c-1.901,1.902-4.984,1.902-6.886,0 c-1.901-1.901-1.901-4.984,0-6.886l53.127-53.128L1.426,8.313L1.426,8.313z"/></g></svg>
            </button>
            <div class="background-image" :style="{ backgroundImage: 'url(' + backgroundImage + ')' }"></div>
            <img :src="cover" alt="Movie Cover" class="cover" />
            <div class="content">
                <h1 class="title">{{ title }}</h1>
                <button class="play-button">
                    <router-link :to="'/movie/' + imdb_code" class="close">
                        <div>
                            <img width="26" height="26" src="https://img.icons8.com/metro/26/play.png" alt="play"/>
                            <span>Play</span>
                        </div>
                    </router-link>
                </button>
                <p class="rating"><img width="24" height="24" src="https://img.icons8.com/fluency/24/star--v1.png" alt="star--v1"/> {{ rating }} / 10</p>
                <p class="year">Year: {{ year }}</p>
                <p class="genres">Genres: {{ genres.join(', ') }}</p>
            </div>
        </div>
    </div>
</template>

<script>
export default {
    name: 'MovieDetails',
    props: {
        backgroundImage: String,
        cover: String,
        title: String,
        rating: Number,
        year: Number,
        genres: Array,
        imdb_code: String
    }
}
</script>

<style scoped>
.container {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    align-content: center;
    background-color: rgba(0, 0, 0, 0.5);
    z-index: 1000;
}

.movie-details {
    display: flex;
    flex-direction: column;
    text-align: center;
    color: white;
    width: 800px;
    min-height: 600px;
    margin: auto;
    background: rgb(34, 34, 34);
    border-radius: 24px;
    overflow: hidden;
}

.background-image {
    width: 100%;
    height: 250px;
    background-size: cover;
}

.cover {
    position: absolute;
    align-self: flex-end;
    width: 200px;
    height: auto;
    transform: translateY(20%);
    margin-right: 24px;
    border-radius: 10px;
}

.content {
    /* max-width: 600px; */
    width: 100%;
    text-align: left;
}

.closeButton {
    position: absolute;
    width: 48px;
    height: 48px;
    margin: 12px;
    border-radius: 24px;
    border: none;
    background-color: rgba(0, 0, 0, 0.363);
    align-content: center;
    cursor: pointer;
}

.closeSvg {
    width: 20px;
    height: 20px;
    margin: auto;
    align-self: center;
    margin-top: 3px;
    fill: rgb(238, 238, 238);
}

.title {
    position: absolute;
    transform: translateY(-110%);
    font-size: 3rem;
    margin: 0;
    margin-left: 24px;
    max-width: 550px;
}

.play-button {
    margin: 24px 36px;
    font-size: 1.5rem;
    color: black;
    background-color: rgb(233, 233, 233);
    border: none;
    border-radius: 12px;
    cursor: pointer;
}

.play-button div {
    margin: 6px 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
}

.play-button span {
    font-size: 1.2rem;
    color: black;
    text-decoration: none;
}

.rating, .year, .genres {
    margin: 0 24px;
}

.rating {
    display: flex;
    flex-direction: row;
    width: fit-content;
    align-items: center;
    gap: 6px;
    font-size: 1.3rem;
    margin-top: 0;
    margin-bottom: 24px;
}

.year, .genres {
    font-size: 1.2rem;
    margin-bottom: 6px;
}

@media (max-width: 800px) {
    .movie-details {
        width: 100%;
        height: 100%;
        border-radius: 0;
    }

    .cover {
        width: 150px;
        transform: translateY(50%);
        /* align-self: flex-start; */
    }

    .title {
        position: static;
        transform: none;
        margin: 24px;
        margin-top: 92px;
    }

    .play-button {
        margin-left: 24px;
        margin-top: 0;
        width: calc(100% - 48px);
        height: 48px;
    }
    
    .play-button span {
        font-size: 1.5rem;
    }
}
</style>