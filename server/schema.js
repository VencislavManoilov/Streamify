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
    rating: { type: 'float', notNullable: true },
    runtime: { type: 'integer', notNullable: true },
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
  }
};

async function ensureSchema() {
  for (const [tableName, columns] of Object.entries(schemaDefinition)) {
    const exists = await knex.schema.hasTable(tableName);

    if (!exists) {
      logger.info(`Creating ${tableName} table...`);
      await knex.schema.createTable(tableName, (table) => {
        for (const [columnName, columnProps] of Object.entries(columns)) {
          let column;
          if (columnProps.type === 'increments') {
            column = table.increments(columnName);
          } else {
            column = table[columnProps.type](columnName);
          }

          if (columnProps.primary) column.primary();
          if (columnProps.notNullable) column.notNullable();
          if (columnProps.unique) column.unique();
          if (columnProps.defaultTo) column.defaultTo(columnProps.defaultTo);
        }
      });
    } else {
      logger.info(`Checking for missing columns in ${tableName} table...`);
      const existingColumns = await knex(tableName).columnInfo();

      for (const [columnName, columnProps] of Object.entries(columns)) {
        if (!existingColumns[columnName]) {
          logger.info(`Adding "${columnName}" column to ${tableName} table...`);
          await knex.schema.alterTable(tableName, (table) => {
            let column;
            if (columnProps.type === 'increments') {
              column = table.increments(columnName);
            } else {
              column = table[columnProps.type](columnName);
            }

            if (columnProps.primary) column.primary();
            if (columnProps.notNullable) column.notNullable();
            if (columnProps.unique) column.unique();
            if (columnProps.defaultTo) column.defaultTo(columnProps.defaultTo);
          });
        }
      }
    }
  }

  logger.info('Schema check complete.');
}

module.exports = ensureSchema;