const logger = require('./logger');

const DAY = 24 * 60 * 60 * 1000;
// Details change rarely, so they are looked up again after a month
const KEEP_DETAILS = 30 * DAY;
// A movie TMDB doesn't know is asked about again the next day
const KEEP_MISSING = DAY;
const CAST_SIZE = 15;
const WRITING_JOBS = ['Screenplay', 'Writer', 'Story', 'Novel', 'Author', 'Original Story', 'Characters'];

// Movies that are being looked up right now, so opening one twice doesn't ask TMDB twice
const loading = new Map(); // IMDb code -> promise of the details

function names(crew, jobs) {
    return [...new Set(crew.filter(person => jobs.includes(person.job)).map(person => person.name))];
}

// The US age rating, preferably the one from the theatrical release
function certification(releaseDates) {
    const countries = (releaseDates && releaseDates.results) || [];
    const us = countries.find(country => country.iso_3166_1 === 'US');
    const releases = ((us && us.release_dates) || []).filter(release => release.certification);
    const release = releases.find(item => item.type === 3) || releases[0];
    return release ? release.certification.trim() : '';
}

function trailer(videos) {
    const youtube = ((videos && videos.results) || []).filter(video => video.site === 'YouTube' && video.key);
    const video = youtube.find(item => item.type === 'Trailer' && item.official)
        || youtube.find(item => item.type === 'Trailer')
        || youtube.find(item => item.type === 'Teaser');
    return video ? { key: video.key, name: video.name || 'Trailer' } : null;
}

// Only what the pages show is kept, TMDB's answers are many times bigger
function normalize(movie) {
    const credits = movie.credits || {};
    const crew = credits.crew || [];
    const cast = (credits.cast || []).slice().sort((a, b) => a.order - b.order);

    return {
        tmdbId: movie.id,
        tagline: movie.tagline || '',
        releaseDate: movie.release_date || null,
        certification: certification(movie.release_dates),
        originalTitle: movie.original_title && movie.original_title !== movie.title ? movie.original_title : '',
        originalLanguage: movie.original_language || '',
        languages: (movie.spoken_languages || []).map(language => language.english_name || language.name).filter(Boolean),
        countries: (movie.production_countries || []).map(country => country.name).filter(Boolean),
        studios: (movie.production_companies || []).slice(0, 4).map(company => company.name).filter(Boolean),
        collection: movie.belongs_to_collection ? movie.belongs_to_collection.name : '',
        budget: movie.budget || 0,
        revenue: movie.revenue || 0,
        directors: names(crew, ['Director']),
        writers: names(crew, WRITING_JOBS),
        composers: names(crew, ['Original Music Composer', 'Music']),
        cinematographers: names(crew, ['Director of Photography']),
        cast: cast.slice(0, CAST_SIZE).map(person => ({
            name: person.name,
            character: person.character || '',
            profilePath: person.profile_path || null
        })),
        trailer: trailer(movie.videos)
    };
}

async function fetchDetails(tmdb, imdbCode) {
    // TMDB has its own ids, the IMDb code has to be looked up first
    const found = await tmdb.get(`/find/${imdbCode}`, { params: { external_source: 'imdb_id' } });
    const match = (found.data.movie_results || [])[0];
    if (!match) return null;

    const response = await tmdb.get(`/movie/${match.id}`, { params: { append_to_response: 'credits,release_dates,videos' } });
    return normalize(response.data);
}

function isFresh(row) {
    const age = Date.now() - new Date(row.fetched_at).getTime();
    return age < (row.data ? KEEP_DETAILS : KEEP_MISSING);
}

/**
 * The details of a movie (null when TMDB doesn't know it). They are kept in the database, so TMDB is
 * only asked the first time and then once a month, or right away with `refresh`. When TMDB can't be
 * reached, details that were looked up before are returned even when they are old.
 */
async function getDetails(knex, tmdb, imdbCode, { refresh = false } = {}) {
    const saved = await knex('movie_details').where({ imdb_code: imdbCode }).first();
    if (saved && !refresh && isFresh(saved)) return saved.data;
    if (!process.env.TMDB_API_KEY) return saved ? saved.data : null;

    if (!loading.has(imdbCode)) {
        const lookup = (async () => {
            const data = await fetchDetails(tmdb, imdbCode);
            await knex('movie_details')
                .insert({ imdb_code: imdbCode, data: JSON.stringify(data), fetched_at: new Date() })
                .onConflict('imdb_code')
                .merge();
            return data;
        })();
        loading.set(imdbCode, lookup.finally(() => loading.delete(imdbCode)));
    }

    try {
        return await loading.get(imdbCode);
    } catch (err) {
        logger.warn(`Could not load the details of ${imdbCode} from TMDB: ${err.message}`);
        if (saved) return saved.data;
        throw err;
    }
}

module.exports = { getDetails };
