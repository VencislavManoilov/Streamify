<template>
    <MovieCatalog :kind="kind" />
</template>

<script>
import MovieCatalog from './MovieCatalog.vue';

// The router only opens this page for logged in users (see router.js)
export default {
    name: 'HomePage',
    components: {
        MovieCatalog
    },
    props: {
        // 'movie' or 'series'
        kind: {
            type: String,
            default: 'movie'
        }
    }
};
</script>
