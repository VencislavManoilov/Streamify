const knex = require('./knex');

const schemaDefinition = {
  users: {
    id: { type: 'increments', primary: true },
    name: { type: 'string', notNullable: true },
    email: { type: 'string', unique: true, notNullable: true },
    created_at: { type: 'timestamp', defaultTo: knex.fn.now() },
  },
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