<template>
    <div class="extras" :class="variant">
        <!-- Placeholders with the rough shape of what's coming, so the card doesn't jump when it loads -->
        <div v-if="loading" class="skeleton" aria-hidden="true">
            <span class="line short"></span>
            <span class="line"></span>
            <div class="cast">
                <span v-for="n in skeletonCount" :key="n" class="person">
                    <span class="photo"></span>
                    <span class="lines"><span class="line"></span><span class="line short"></span></span>
                </span>
            </div>
        </div>

        <template v-else-if="details">
            <dl v-if="crew.length" class="crew">
                <div v-for="row in crew" :key="row.label" class="crew-row">
                    <dt>{{ row.label }}</dt>
                    <dd>{{ row.names }}</dd>
                </div>
            </dl>

            <section v-if="cast.length" class="section">
                <h3>Cast</h3>
                <ul class="cast">
                    <li v-for="(person, index) in cast" :key="index" class="person">
                        <img
                            v-if="person.profilePath"
                            class="photo"
                            :src="photo(person.profilePath)"
                            :srcset="`${photo(person.profilePath)} 1x, ${photo(person.profilePath, 'h632')} 2x`"
                            alt=""
                            loading="lazy"
                        />
                        <span v-else class="photo initials" aria-hidden="true">{{ initials(person.name) }}</span>
                        <span class="who">
                            <span class="name">{{ person.name }}</span>
                            <span v-if="person.character" class="character">{{ person.character }}</span>
                            <span v-if="isPage && person.episodes > 1" class="episodes">{{ person.episodes }} episodes</span>
                        </span>
                    </li>
                </ul>
            </section>

            <section v-if="facts.length" class="section">
                <h3 v-if="variant === 'page'">Details</h3>
                <dl class="facts">
                    <div v-for="fact in facts" :key="fact.label" class="fact" :class="{ wide: fact.wide }">
                        <dt>{{ fact.label }}</dt>
                        <dd>{{ fact.value }}</dd>
                    </div>
                </dl>
            </section>
        </template>
    </div>
</template>

<script>
import { profileImage } from '../movieDetails';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
const languageNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'language' }) : null;

// TMDB dates are plain days, read as UTC they'd show the day before in timezones west of it
function formatDate(date) {
    const [year, month, day] = String(date).split('-').map(Number);
    if (!year || !month || !day) return '';
    return new Date(year, month - 1, day).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function languageName(code) {
    try {
        return (languageNames && languageNames.of(code)) || code;
    } catch (err) {
        return code;
    }
}

export default {
    name: 'MovieExtras',
    props: {
        // From /movies/:imdb_code/details or /series/:imdb_code/details; null when TMDB doesn't know it
        details: {
            type: Object,
            default: null
        },
        loading: {
            type: Boolean,
            default: false
        },
        // 'card' is the short version for the movie card, 'page' everything for the movie page
        variant: {
            type: String,
            default: 'card'
        }
    },
    computed: {
        isPage() {
            return this.variant === 'page';
        },
        // Series details name their creators where movies name a director
        isSeries() {
            return Array.isArray(this.details && this.details.creators);
        },
        skeletonCount() {
            return this.isPage ? 8 : 6;
        },
        crew() {
            const details = this.details;
            if (this.isSeries) {
                return [
                    { label: 'Created by', people: details.creators },
                    { label: details.networks && details.networks.length > 1 ? 'Networks' : 'Network', people: details.networks }
                ]
                    .filter(row => row.people && row.people.length)
                    .map(row => ({ label: row.label, names: row.people.slice(0, 4).join(', ') }));
            }
            const rows = [
                { label: details.directors.length > 1 ? 'Directors' : 'Director', people: details.directors },
                { label: details.writers.length > 1 ? 'Writers' : 'Writer', people: details.writers }
            ];
            if (this.isPage) {
                rows.push({ label: 'Music', people: details.composers });
                rows.push({ label: 'Cinematography', people: details.cinematographers });
            }
            return rows
                .filter(row => row.people && row.people.length)
                .map(row => ({ label: row.label, names: row.people.slice(0, 4).join(', ') }));
        },
        cast() {
            return (this.details.cast || []).slice(0, this.isPage ? 15 : 8);
        },
        facts() {
            const details = this.details;
            const languages = details.languages && details.languages.length
                ? details.languages.join(', ')
                : (details.originalLanguage ? languageName(details.originalLanguage) : '');
            const facts = this.isSeries ? [
                { label: 'First aired', value: details.firstAired ? formatDate(details.firstAired) : '' },
                { label: 'Last aired', value: details.lastAired ? formatDate(details.lastAired) : '' },
                { label: 'Type', value: details.type && details.type !== 'Scripted' ? details.type : '' },
                { label: 'Original title', value: details.originalTitle }
            ] : [
                { label: 'Released', value: details.releaseDate ? formatDate(details.releaseDate) : '' },
                { label: 'Original title', value: details.originalTitle },
                { label: details.languages && details.languages.length > 1 ? 'Languages' : 'Language', value: languages },
                { label: details.countries && details.countries.length > 1 ? 'Countries' : 'Country', value: (details.countries || []).join(', ') }
            ];
            if (this.isSeries) {
                facts.push(
                    { label: details.languages && details.languages.length > 1 ? 'Languages' : 'Language', value: languages },
                    { label: details.countries && details.countries.length > 1 ? 'Countries' : 'Country', value: (details.countries || []).join(', ') }
                );
                if (this.isPage) facts.push({ label: 'Studios', value: (details.studios || []).join(', '), wide: true });
            } else if (this.isPage) {
                facts.push(
                    { label: 'Studios', value: (details.studios || []).join(', '), wide: true },
                    { label: 'Budget', value: details.budget ? money.format(details.budget) : '' },
                    { label: 'Box office', value: details.revenue ? money.format(details.revenue) : '' },
                    { label: 'Collection', value: details.collection }
                );
            }
            return facts.filter(fact => fact.value);
        }
    },
    methods: {
        photo(path, size) {
            return profileImage(path, size);
        },
        initials(name) {
            return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
        }
    }
};
</script>

<style scoped>
.extras {
    display: flex;
    flex-direction: column;
    gap: 26px;
}

.section h3 {
    margin: 0 0 14px;
    font-size: 1.05rem;
    font-weight: 700;
    font-stretch: 112%;
    letter-spacing: 0.01em;
}

.page .section h3 {
    font-size: 1.3rem;
}

/* Director, writers and the rest as a label column next to the names */
.crew {
    display: grid;
    gap: 8px;
    margin: 0;
}

.crew-row {
    display: grid;
    grid-template-columns: 7rem minmax(0, 1fr);
    gap: 16px;
}

.page .crew-row {
    grid-template-columns: 9.5rem minmax(0, 1fr);
}

.crew dt,
.fact dt {
    color: var(--text-faint);
    font-size: 0.92rem;
    font-weight: 600;
    letter-spacing: 0.02em;
}

.crew dt {
    padding-top: 1px;
}

.crew dd,
.fact dd {
    margin: 0;
    color: var(--text);
}

.cast {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    gap: 14px 20px;
    margin: 0;
    padding: 0;
    list-style: none;
}

.person {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
}

.photo {
    flex: none;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    object-fit: cover;
    background: var(--surface-strong);
    box-shadow: 0 0 0 1px var(--line), 0 6px 16px rgba(0, 0, 0, 0.3);
}

.page .photo {
    width: 60px;
    height: 60px;
}

.initials {
    display: grid;
    place-items: center;
    background: linear-gradient(135deg, rgba(125, 108, 240, 0.35), rgba(22, 108, 138, 0.3));
    color: var(--text-muted);
    font-size: 0.95rem;
    font-weight: 700;
    letter-spacing: 0.04em;
}

.who {
    display: flex;
    flex-direction: column;
    min-width: 0;
}

/* Long names get a second line instead of being cut off */
.name {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
    font-weight: 650;
    line-height: 1.3;
}

.episodes {
    color: var(--text-faint);
    font-size: 0.82rem;
    line-height: 1.3;
}

.character {
    color: var(--text-muted);
    font-size: 0.9rem;
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* Release date, languages and so on as small labeled values */
.facts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 16px 24px;
    margin: 0;
}

.fact {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
}

.fact.wide {
    grid-column: span 2;
}

.fact dd {
    overflow-wrap: anywhere;
}

.skeleton {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.skeleton .line {
    display: block;
    width: 60%;
    height: 12px;
    border-radius: 6px;
    background: var(--surface-strong);
    animation: shimmer 1.4s ease-in-out infinite;
}

.skeleton .line.short {
    width: 35%;
}

.skeleton .cast {
    margin-top: 12px;
}

.skeleton .photo {
    box-shadow: none;
    animation: shimmer 1.4s ease-in-out infinite;
}

.skeleton .lines {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 8px;
}

.skeleton .lines .line {
    width: 80%;
}

.skeleton .lines .line.short {
    width: 50%;
}

@keyframes shimmer {
    0%, 100% { opacity: 0.55; }
    50% { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
    .skeleton .line,
    .skeleton .photo {
        animation: none;
    }
}

@media (max-width: 640px) {
    .crew-row,
    .page .crew-row {
        grid-template-columns: 7.5rem minmax(0, 1fr);
        gap: 12px;
    }

    .cast {
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: 12px 14px;
    }

    .photo,
    .page .photo {
        width: 46px;
        height: 46px;
    }

    .facts {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}
</style>
