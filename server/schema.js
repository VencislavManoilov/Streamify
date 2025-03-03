const knex = require('./knex');

const schemaDefinition = {
  users: {
    id: { type: 'increments', primary: true },
    name: { type: 'string', notNullable: true },
    email: { type: 'string', unique: true, notNullable: true },
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
    summary: { type: 'string', notNullable: true },
    background_image: { type: 'string', notNullable: true },
    small_cover_image: { type: 'string', notNullable: true },
    medium_cover_image: { type: 'string', notNullable: true },
    large_cover_image: { type: 'string', notNullable: true },
    torrents: { type: 'json', notNullable: true },
    created_at: { type: 'timestamp', defaultTo: knex.fn.now() },
  }
};

async function ensureSchema() {
  for (const [tableName, columns] of Object.entries(schemaDefinition)) {
    const exists = await knex.schema.hasTable(tableName);

    if (!exists) {
      console.log(`Creating ${tableName} table...`);
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
      console.log(`Checking for missing columns in ${tableName} table...`);
      const existingColumns = await knex(tableName).columnInfo();

      for (const [columnName, columnProps] of Object.entries(columns)) {
        if (!existingColumns[columnName]) {
          console.log(`Adding "${columnName}" column to ${tableName} table...`);
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

  console.log('Schema check complete.');
}

module.exports = ensureSchema;