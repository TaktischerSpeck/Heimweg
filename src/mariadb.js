import mariadb from 'mariadb';

// Translate numbered parameters and identifiers only; quoted SQL literals remain untouched.
export function compileMaria(sql, values = []) {
  const parameters = [];
  const text = sql.replace(
    /'(?:''|[^'])*'|`(?:``|[^`])*`|"(?:""|[^"])*"|\$(\d+)|\bkey\b/g,
    (part, index) => {
      if (index) {
        parameters.push(values[Number(index) - 1]);
        return '?';
      }
      if (part.startsWith('"'))
        return '`' + part.slice(1, -1).replaceAll('""', '"').replaceAll('`', '``') + '`';
      if (part === 'key') return '`key`';
      return part;
    },
  );
  return { sql: text, parameters };
}
function connectionAdapter(connection, release) {
  return {
    dialect: 'mariadb',
    async query(sql, values) {
      const compiled = compileMaria(sql, values);
      const result = await connection.query(compiled.sql, compiled.parameters);
      const rows = Array.isArray(result)
        ? result.map((row) => {
            if ('locked' in row) row.locked = Boolean(row.locked);
            return row;
          })
        : [];
      return { rows, rowCount: Array.isArray(result) ? rows.length : Number(result.affectedRows) };
    },
    release,
  };
}
export function createMariaPool(database) {
  const pool = mariadb.createPool({
    host: database.host,
    port: database.port,
    user: database.user,
    password: database.password,
    database: database.database,
    ssl: database.ssl || undefined,
    connectionLimit: 10,
    connectTimeout: 5000,
    acquireTimeout: 10000,
    foundRows: true,
    charset: 'utf8mb4',
    timezone: '+00:00',
    initSql: [
      'SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ',
      'SET SESSION max_statement_time = 15',
    ],
  });
  const adapter = connectionAdapter(pool);
  return {
    ...adapter,
    async connect() {
      const connection = await pool.getConnection();
      return connectionAdapter(connection, () => connection.release());
    },
    end: () => pool.end(),
    on: (...args) => pool.on(...args),
  };
}
