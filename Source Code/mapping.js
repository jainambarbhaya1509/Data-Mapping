const { Pool } = require("pg");
const readline = require("readline");
const util = require("util");

// PostgreSQL Server Information
const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "test",
  password: "admin",
  port: 5432,
});

// Promisify readline.question method
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
const question = util.promisify(rl.question).bind(rl);

// Connect to PostgreSQL Database
async function connectToPostgreSQL() {
  try {
    await pool.connect();
    console.log("Connected to PostgreSQL");
  } catch (error) {
    throw error;
  }
}

// Disconnect from PostgreSQL Database
async function disconnectFromPostgreSQL() {
  try {
    await pool.end();
    console.log("Disconnected from PostgreSQL");
  } catch (error) {
    throw error;
  }
}

async function dataMapping() {
  try {
    const source_cols_dt = [];

    const schema = await question("Enter schema: ");
    console.log();
    const source_table = await question("Enter source table: ");
    const source_table_cols = (
      await question("Enter source table columns (comma-separated): ")
    )
      .replace(/\s+/g, "")
      .split(",");

    for (const source_column of source_table_cols) {
      const sourceExists = await checkTable(
        schema,
        source_table,
        source_column
      );
      console.log();

      if (!sourceExists) {
        console.log("Schema, Table, or Column does not exist.");
        return;
      } else {
        const data_type = await getSourceDatatype(
          source_table,
          source_column,
          source_cols_dt
        );
        source_cols_dt.push(data_type);
      }
    }
    console.log();

    const destination_table = await question("Enter destination table: ");
    const destination_table_cols = (
      await question("Enter destination table columns (comma-separated): ")
    )
      .replace(/\s+/g, "")
      .split(",");

    for (const destination_column of destination_table_cols) {
      const destinationExists = await checkTable(
        schema,
        destination_table,
        destination_column
      );

      if (!destinationExists) {
        console.log("\nSchema, Table, or Column does not exist.");
        const askCreate = await question(
          `Table "${destination_table}" does not exist. Do you want to create it (Y/n): `
        );
        console.log();

        if (askCreate === "Y" || askCreate === "y") {
          const tableCols = destination_table_cols
            .map((_, index) => `${destination_table_cols[index]} ${source_cols_dt[index]}`)
            .join(", ");
          await createTable(schema, destination_table, tableCols);
          await addPrimaryKey(schema, destination_table);
        } else {
          return;
        }
      }
    }

    await mapData(
      destination_table,
      destination_table_cols,
      source_table_cols,
      source_table
    );
    console.log();

  } catch (error) {
    throw error;
  } finally {
    await disconnectFromPostgreSQL();
  }
}

async function checkTable(schema, table, table_col) {
  try {
    const client = await pool.connect();

    const query = `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = '${schema}'
        AND table_name = '${table}'
      ) AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = '${schema}'
        AND table_name = '${table}'
        AND column_name = '${table_col}'
      ) AS column_exists;
    `;
    const result = await client.query(query);
    const columnExists = result.rows[0].column_exists;
    client.release();

    return columnExists;
  } catch (error) {
    throw error;
  }
}

async function mapData(
  destination_table,
  destination_table_cols,
  source_table_cols,
  source_table
) {
  try {
    const client = await pool.connect();

    const destinationColumns = destination_table_cols.join(", ");
    const sourceColumns = source_table_cols.join(", ");

    const query = `INSERT INTO ${destination_table} (${destinationColumns})
      SELECT ${sourceColumns}
      FROM ${source_table}
      WHERE NOT EXISTS (
      SELECT 1
      FROM ${destination_table}
      WHERE (${destinationColumns}) = (${sourceColumns})
      ) ORDER BY ${sourceColumns} ASC;`;

    await client.query(query);
    client.release();
    console.log(`Data mapped into table "${destination_table}"`);
  } catch (error) {
    throw error;
  }
}

async function createTable(schema, destination_table, tableCols) {
  try {
    const client = await pool.connect();
    const query = `CREATE TABLE IF NOT EXISTS ${schema}.${destination_table} ( ${tableCols} );`;
    await client.query(query);
    client.release();
    console.log(`Destination table "${destination_table}" created`);
  } catch (error) {
    throw error;
  }
}

async function getSourceDatatype(source_table, source_column) {
  try {
    const client = await pool.connect();
    const query = `SELECT attname, format_type(atttypid, atttypmod) AS data_type
      FROM pg_attribute
      WHERE attrelid = '${source_table}'::regclass
      AND attname = '${source_column}'
      AND attnum > 0;
      `;

    const result = await client.query(query);
    const data_type = result.rows[0].data_type;

    client.release();

    return data_type;
  } catch (error) {
    throw error;
  }
}

async function addPrimaryKey(schema, destination_table) {
  try {
    const client = await pool.connect();
    const query = `
      ALTER TABLE ${schema}.${destination_table}
      ADD COLUMN id SERIAL PRIMARY KEY;
    `;
    await client.query(query);
    client.release();
    console.log(`Serial primary key added to "${destination_table}"`);
  } catch (error) {
    throw error;
  }
}


// Main function
async function main() {
  try {
    await connectToPostgreSQL();
    await dataMapping();
  } catch (error) {
    throw error;
  } finally {
    await disconnectFromPostgreSQL();
  }
}

// Call the main function
main();