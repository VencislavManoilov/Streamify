const knex = require('./knex');
const logger = require('./utils/logger');

const schemaDefinition = {
  users: {
    id: { type: 'increments', primary: true },
    username: { type: 'string', notNullable: true },
    email: { type: 'string', unique: true, notNullable: true },
    password: { type: 'string', notNullable: true },
    role: { type: 'string', defaultTo: 'user' },
    created_at: { type: 'timestamp', defaultTo: knex.fn.now() },
  },
  movies: {
    id: { type: 'increments', primary: true },
    imdb_code: { type: 'string', unique: true, notNullable: true },
    slug: { type: 'string', unique: true, notNullable: true },
    title: { type: 'string', notNullable: true },
    genres: { type: 'json', notNullable: true },
    year: { type: 'integer', notNullable: true },
    rating: { type: 'float', notNullable: true, defaultTo: 0 },
    runtime: { type: 'integer', notNullable: false },
    summary: { type: 'text', notNullable: true },
    background_image: { type: 'text', notNullable: true },
    small_cover_image: { type: 'text', notNullable: true },
    medium_cover_image: { type: 'text', notNullable: true },
    large_cover_image: { type: 'text', notNullable: true },
    torrents: { type: 'json', notNullable: true },
    // When someone last reset the movie (looked it up on YTS again), so it can't be reset over and over
    reset_at: { type: 'timestamp', notNullable: false },
    created_at: { type: 'timestamp', defaultTo: knex.fn.now() },
  },
  // Cast, crew and the other details TMDB has about a movie, looked up the first time someone opens it.
  // `data` is null when TMDB doesn't know the movie.
  movie_details: {
    id: { type: 'increments', primary: true },
    imdb_code: { type: 'string', unique: true, notNullable: true },
    data: { type: 'json', notNullable: false },
    fetched_at: { type: 'timestamp', defaultTo: knex.fn.now() },
  },
  categories: {
    id: { type: 'increments', primary: true },
    name: { type: 'string', unique: true, notNullable: true },
    movies: { type: 'json', notNullable: true },
    created_at: { type: 'timestamp', defaultTo: knex.fn.now() },
  },
  // One row per user and movie: where they stopped and how long they have watched it
  watch_history: {
    id: { type: 'increments', primary: true },
    user_id: { type: 'integer', notNullable: true, references: 'users.id', onDelete: 'CASCADE' },
    imdb_code: { type: 'string', notNullable: true },
    position: { type: 'float', notNullable: true, defaultTo: 0 },
    duration: { type: 'float', notNullable: true, defaultTo: 0 },
    watched_seconds: { type: 'float', notNullable: true, defaultTo: 0 },
    completed: { type: 'boolean', notNullable: true, defaultTo: false },
    last_watched_at: { type: 'timestamp', defaultTo: knex.fn.now() },
    created_at: { type: 'timestamp', defaultTo: knex.fn.now() },
  },
  // Movies and series a user saved for later. A movie leaves the list once it has been watched to the end,
  // a series once its last episode has been and it won't get new ones.
  watchlist: {
    id: { type: 'increments', primary: true },
    user_id: { type: 'integer', notNullable: true, references: 'users.id', onDelete: 'CASCADE' },
    imdb_code: { type: 'string', notNullable: true },
    created_at: { type: 'timestamp', defaultTo: knex.fn.now() },
  },
  // Series from TMDB. The poster and backdrop columns are named like the movie ones, so pages list both alike.
  series: {
    id: { type: 'increments', primary: true },
    imdb_code: { type: 'string', unique: true, notNullable: true },
    tmdb_id: { type: 'integer', notNullable: true },
    title: { type: 'string', notNullable: true },
    original_title: { type: 'string', notNullable: false },
    year: { type: 'integer', notNullable: false },
    // Set once the series has ended
    end_year: { type: 'integer', notNullable: false },
    status: { type: 'string', notNullable: false },
    genres: { type: 'json', notNullable: true },
    rating: { type: 'float', notNullable: true, defaultTo: 0 },
    // Minutes of a typical episode
    runtime: { type: 'integer', notNullable: false },
    number_of_seasons: { type: 'integer', notNullable: true, defaultTo: 0 },
    number_of_episodes: { type: 'integer', notNullable: true, defaultTo: 0 },
    summary: { type: 'text', notNullable: true },
    background_image: { type: 'text', notNullable: true },
    small_cover_image: { type: 'text', notNullable: true },
    medium_cover_image: { type: 'text', notNullable: true },
    large_cover_image: { type: 'text', notNullable: true },
    networks: { type: 'json', notNullable: false },
    // { season, episode, name, airDate } as TMDB numbers them
    last_episode: { type: 'json', notNullable: false },
    next_episode: { type: 'json', notNullable: false },
    original_language: { type: 'string', notNullable: false },
    certification: { type: 'string', notNullable: false },
    // Cast, creators, trailer..., looked up the first time someone opens the series
    details: { type: 'json', notNullable: false },
    details_fetched_at: { type: 'timestamp', notNullable: false },
    // Whether torrent add-ons have its first episode. Series without torrents are left out of lists.
    available: { type: 'boolean', notNullable: false },
    available_checked_at: { type: 'timestamp', notNullable: false },
    fetched_at: { type: 'timestamp', defaultTo: knex.fn.now() },
    created_at: { type: 'timestamp', defaultTo: knex.fn.now() },
  },
  // Every season and episode of a series, numbered like the torrent add-ons number them (see utils/series.js)
  series_episodes: {
    id: { type: 'increments', primary: true },
    imdb_code: { type: 'string', unique: true, notNullable: true },
    seasons: { type: 'json', notNullable: true },
    fetched_at: { type: 'timestamp', defaultTo: knex.fn.now() },
  },
  series_categories: {
    id: { type: 'increments', primary: true },
    name: { type: 'string', unique: true, notNullable: true },
    series: { type: 'json', notNullable: true },
    created_at: { type: 'timestamp', defaultTo: knex.fn.now() },
  },
  // The torrents found for an episode, kept for a few hours (see utils/streamSources.js)
  episode_sources: {
    id: { type: 'increments', primary: true },
    imdb_code: { type: 'string', notNullable: true },
    season: { type: 'integer', notNullable: true },
    episode: { type: 'integer', notNullable: true },
    sources: { type: 'json', notNullable: true },
    // Set when an add-on couldn't be asked, so the list is looked up again soon
    partial: { type: 'boolean', notNullable: true, defaultTo: false },
    fetched_at: { type: 'timestamp', defaultTo: knex.fn.now() },
  },
  // One row per user and episode, like watch_history is for movies
  episode_history: {
    id: { type: 'increments', primary: true },
    user_id: { type: 'integer', notNullable: true, references: 'users.id', onDelete: 'CASCADE' },
    imdb_code: { type: 'string', notNullable: true },
    season: { type: 'integer', notNullable: true },
    episode: { type: 'integer', notNullable: true },
    position: { type: 'float', notNullable: true, defaultTo: 0 },
    duration: { type: 'float', notNullable: true, defaultTo: 0 },
    watched_seconds: { type: 'float', notNullable: true, defaultTo: 0 },
    completed: { type: 'boolean', notNullable: true, defaultTo: false },
    last_watched_at: { type: 'timestamp', defaultTo: knex.fn.now() },
    created_at: { type: 'timestamp', defaultTo: knex.fn.now() },
  },
  // People who asked to join. Kept here so a request isn't lost when the email to the admin fails.
  access_requests: {
    id: { type: 'increments', primary: true },
    email: { type: 'string', unique: true, notNullable: true },
    invited_at: { type: 'timestamp', notNullable: false },
    created_at: { type: 'timestamp', defaultTo: knex.fn.now() },
  }
};

// Constraints that span more than one column, added when the table is created
const tableConstraints = {
  watch_history: {
    unique: [['user_id', 'imdb_code']],
  },
  watchlist: {
    unique: [['user_id', 'imdb_code']],
  },
  episode_sources: {
    unique: [['imdb_code', 'season', 'episode']],
  },
  episode_history: {
    unique: [['user_id', 'imdb_code', 'season', 'episode']],
  }
};

function addColumn(table, columnName, columnProps) {
  let column;
  if (columnProps.type === 'increments') {
    column = table.increments(columnName);
  } else {
    column = table[columnProps.type](columnName);
  }

  if (columnProps.primary) column.primary();
  if (columnProps.notNullable) column.notNullable();
  if (columnProps.unique) column.unique();
  if (columnProps.defaultTo !== undefined) column.defaultTo(columnProps.defaultTo);
  if (columnProps.references) {
    column.references(columnProps.references);
    if (columnProps.onDelete) column.onDelete(columnProps.onDelete);
  }
}

async function ensureSchema() {
  for (const [tableName, columns] of Object.entries(schemaDefinition)) {
    const exists = await knex.schema.hasTable(tableName);

    if (!exists) {
      logger.info(`Creating ${tableName} table...`);
      await knex.schema.createTable(tableName, (table) => {
        for (const [columnName, columnProps] of Object.entries(columns)) {
          addColumn(table, columnName, columnProps);
        }

        const constraints = tableConstraints[tableName] || {};
        for (const uniqueColumns of constraints.unique || []) {
          table.unique(uniqueColumns);
        }
      });
    } else {
      logger.info(`Checking for missing columns in ${tableName} table...`);
      const existingColumns = await knex(tableName).columnInfo();

      for (const [columnName, columnProps] of Object.entries(columns)) {
        if (!existingColumns[columnName]) {
          logger.info(`Adding "${columnName}" column to ${tableName} table...`);
          await knex.schema.alterTable(tableName, (table) => {
            addColumn(table, columnName, columnProps);
          });
        }
      }
    }
  }

  logger.info('Schema check complete.');
}

module.exports = ensureSchema;
