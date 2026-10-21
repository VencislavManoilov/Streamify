<template>
    <form class="search-bar" role="search" @submit.prevent="searchMovies">
        <button class="icon-button" type="submit" aria-label="Search">
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="11" r="6.5" />
                <path d="M16 16l4.5 4.5" />
            </svg>
        </button>
        <input
            ref="searchInput"
            v-model="searchQuery"
            type="search"
            placeholder="Search movies and series"
            aria-label="Search movies and series"
            enterkeyhint="search"
            autocomplete="off"
            spellcheck="false"
            @keydown.esc="$refs.searchInput.blur()"
        />
        <button v-if="searchQuery" class="icon-button clear" type="button" aria-label="Clear search" @click="clear">
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 7l10 10M17 7L7 17" />
            </svg>
        </button>
        <kbd v-else class="shortcut" aria-hidden="true" title="Press / to search">/</kbd>
    </form>
</template>

<script>
export default {
    name: 'SearchBar',
    data() {
        return {
            searchQuery: this.$route.name === 'Search' ? (this.$route.query.query || '') : ''
        };
    },
    watch: {
        '$route.query.query'(query) {
            if (this.$route.name === 'Search') this.searchQuery = query || '';
        }
    },
    mounted() {
        // Press "/" anywhere to start searching
        this.keyHandler = (e) => {
            if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
            const active = document.activeElement;
            if (active && (active.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName))) return;
            e.preventDefault();
            this.$refs.searchInput.focus();
        };
        window.addEventListener('keydown', this.keyHandler);
    },
    beforeUnmount() {
        window.removeEventListener('keydown', this.keyHandler);
    },
    methods: {
        searchMovies() {
            const query = this.searchQuery.trim();
            this.searchQuery = query;
            if (!query) {
                this.$refs.searchInput.focus();
                return;
            }

            // Hide the keyboard on phones
            this.$refs.searchInput.blur();

            const location = { name: 'Search', query: { query } };
            // A new search from the results page replaces it, so "back" leaves the search in one step
            if (this.$route.name === 'Search') {
                this.$router.replace(location);
            } else {
                this.$router.push(location);
            }
        },
        clear() {
            this.searchQuery = '';
            this.$refs.searchInput.focus();
        }
    }
};
</script>

<style scoped>
.search-bar {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
    max-width: 480px;
    height: 44px;
    border-radius: 22px;
    background: var(--surface);
    border: 1px solid var(--line);
    transition: background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}

.search-bar:hover {
    background: var(--surface-strong);
}

.search-bar:focus-within {
    background: rgba(12, 13, 24, 0.85);
    border-color: rgba(233, 195, 123, 0.55);
    box-shadow: 0 0 0 4px rgba(233, 195, 123, 0.12);
}

input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0 4px;
    border: none;
    outline: none;
    background: transparent;
    color: var(--text);
    font-size: 1rem;
}

input::placeholder {
    color: var(--text-faint);
}

/* The clear button below replaces the browser's own */
input::-webkit-search-cancel-button {
    -webkit-appearance: none;
}

.icon-button {
    flex: none;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    margin: 0 2px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: color 0.2s ease, background-color 0.2s ease;
}

.icon-button:hover {
    color: var(--text);
    background: var(--surface);
}

.icon-button svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
}

.clear svg {
    width: 18px;
    height: 18px;
}

.shortcut {
    flex: none;
    margin-right: 12px;
    padding: 1px 7px;
    border: 1px solid var(--line);
    border-radius: 6px;
    color: var(--text-faint);
    font-family: inherit;
    font-size: 0.8rem;
    line-height: 1.4;
}

@media (hover: none) {
    .shortcut {
        display: none;
    }
}
</style>
