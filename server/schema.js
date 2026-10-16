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
    created_at: { type: 'timestamp', defaultTo: knex.fn.now() },
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
  // Movies a user saved for later. A movie leaves the list once it has been watched to the end.
  watchlist: {
    id: { type: 'increments', primary: true },
    user_id: { type: 'integer', notNullable: true, references: 'users.id', onDelete: 'CASCADE' },
    imdb_code: { type: 'string', notNullable: true },
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
