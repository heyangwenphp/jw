const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

const ROOT_DIR = path.resolve(__dirname, '..')
const DEFAULT_CSV_PATH = path.join(ROOT_DIR, 'wechat_765.csv')
const DEFAULT_DB_PATH = path.join(ROOT_DIR, 'wechat_765.sqlite')
const TABLE_NAME = 'wechat_articles'
const BATCH_SIZE = 500

const INTEGER_COLUMNS = new Set(['word_count', 'matched_keyword_count'])
const REAL_COLUMNS = new Set(['confidence'])
const BOOLEAN_COLUMNS = new Set(['favorite'])
const INDEX_COLUMNS = ['published_at', 'account_id', 'account_name', 'subject', 'topic', 'level']

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`
}

function resolveInputPath(inputPath, defaultPath) {
  return path.resolve(ROOT_DIR, inputPath || defaultPath)
}

function columnType(column) {
  if (INTEGER_COLUMNS.has(column) || BOOLEAN_COLUMNS.has(column)) return 'INTEGER'
  if (REAL_COLUMNS.has(column)) return 'REAL'
  return 'TEXT'
}

function normalizeValue(column, value) {
  if (value === '') return null

  if (BOOLEAN_COLUMNS.has(column)) {
    if (/^(true|1)$/i.test(value)) return 1
    if (/^(false|0)$/i.test(value)) return 0
    return null
  }

  if (INTEGER_COLUMNS.has(column)) {
    const numberValue = Number(value)
    return Number.isFinite(numberValue) ? Math.trunc(numberValue) : null
  }

  if (REAL_COLUMNS.has(column)) {
    const numberValue = Number(value)
    return Number.isFinite(numberValue) ? numberValue : null
  }

  return value
}

function ensureValidColumns(columns) {
  const seen = new Set()

  for (const column of columns) {
    if (!column) {
      throw new Error('CSV header contains an empty column name.')
    }
    if (seen.has(column)) {
      throw new Error(`CSV header contains duplicate column: ${column}`)
    }
    seen.add(column)
  }

  if (!seen.has('id')) {
    throw new Error('CSV header must contain an id column.')
  }
}

function createSchema(db, columns) {
  const columnDefinitions = columns.map((column) => {
    const type = columnType(column)
    const primaryKey = column === 'id' ? ' PRIMARY KEY' : ''
    return `${quoteIdentifier(column)} ${type}${primaryKey}`
  })

  db.exec(`
    DROP TABLE IF EXISTS ${quoteIdentifier(TABLE_NAME)};
    DROP TABLE IF EXISTS import_metadata;

    CREATE TABLE ${quoteIdentifier(TABLE_NAME)} (
      ${columnDefinitions.join(',\n      ')}
    );

    CREATE TABLE import_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  for (const column of INDEX_COLUMNS) {
    if (!columns.includes(column)) continue
    const indexName = `idx_${TABLE_NAME}_${column}`
    db.exec(`CREATE INDEX ${quoteIdentifier(indexName)} ON ${quoteIdentifier(TABLE_NAME)} (${quoteIdentifier(column)});`)
  }
}

function prepareInsert(db, columns) {
  const quotedColumns = columns.map(quoteIdentifier).join(', ')
  const placeholders = columns.map(() => '?').join(', ')
  return db.prepare(`INSERT OR REPLACE INTO ${quoteIdentifier(TABLE_NAME)} (${quotedColumns}) VALUES (${placeholders})`)
}

function createCsvParser(onRow) {
  let row = []
  let field = ''
  let inQuotes = false
  let maybeQuoteClosed = false
  let pendingCarriageReturn = false

  const endField = () => {
    row.push(field)
    field = ''
  }

  const endRow = () => {
    onRow(row)
    row = []
  }

  const handleOutsideQuote = (char) => {
    if (pendingCarriageReturn) {
      pendingCarriageReturn = false
      if (char === '\n') return
    }

    if (char === '"') {
      if (field.length === 0) {
        inQuotes = true
        return
      }
      field += char
      return
    }

    if (char === ',') {
      endField()
      return
    }

    if (char === '\n') {
      endField()
      endRow()
      return
    }

    if (char === '\r') {
      endField()
      endRow()
      pendingCarriageReturn = true
      return
    }

    field += char
  }

  const handleChar = (char) => {
    if (inQuotes) {
      if (maybeQuoteClosed) {
        if (char === '"') {
          field += '"'
          maybeQuoteClosed = false
          return
        }

        inQuotes = false
        maybeQuoteClosed = false
        handleOutsideQuote(char)
        return
      }

      if (char === '"') {
        maybeQuoteClosed = true
        return
      }

      field += char
      return
    }

    handleOutsideQuote(char)
  }

  const finish = () => {
    if (inQuotes && maybeQuoteClosed) {
      inQuotes = false
      maybeQuoteClosed = false
    }

    if (inQuotes) {
      throw new Error('CSV ended inside a quoted field.')
    }

    if (field.length > 0 || row.length > 0) {
      endField()
      endRow()
    }
  }

  return { handleChar, finish }
}

async function parseCsv(csvPath, onRow) {
  const parser = createCsvParser(onRow)
  const stream = fs.createReadStream(csvPath, { encoding: 'utf8' })

  for await (const chunk of stream) {
    for (const char of chunk) {
      parser.handleChar(char)
    }
  }

  parser.finish()
}

async function importCsv(csvPath, dbPath) {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found: ${csvPath}`)
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true })

  const db = new Database(dbPath)
  db.pragma('journal_mode = DELETE')
  db.pragma('synchronous = OFF')
  db.pragma('temp_store = MEMORY')

  let columns = null
  let insertRow = null
  let insertBatch = null
  let rowNumber = 0
  let importedCount = 0
  let batch = []

  const flushBatch = () => {
    if (batch.length === 0) return
    insertBatch(batch)
    batch = []
  }

  try {
    await parseCsv(csvPath, (rawRow) => {
      rowNumber += 1

      if (rowNumber === 1) {
        columns = rawRow.map((column, index) => (index === 0 ? column.replace(/^\uFEFF/, '') : column))
        ensureValidColumns(columns)
        createSchema(db, columns)
        insertRow = prepareInsert(db, columns)
        insertBatch = db.transaction((rows) => {
          for (const row of rows) insertRow.run(row)
        })
        return
      }

      if (rawRow.length === 1 && rawRow[0] === '') return

      if (rawRow.length > columns.length) {
        throw new Error(`Row ${rowNumber} has ${rawRow.length} values, expected ${columns.length}.`)
      }

      const paddedRow = rawRow.concat(Array(Math.max(columns.length - rawRow.length, 0)).fill(''))
      const normalizedRow = columns.map((column, index) => normalizeValue(column, paddedRow[index]))
      batch.push(normalizedRow)
      importedCount += 1

      if (batch.length >= BATCH_SIZE) {
        flushBatch()
      }

      if (importedCount % 5000 === 0) {
        console.log(`Imported ${importedCount} rows...`)
      }
    })

    if (!columns) {
      throw new Error('CSV file is empty.')
    }

    flushBatch()

    const metadataStmt = db.prepare('INSERT INTO import_metadata (key, value) VALUES (?, ?)')
    const writeMetadata = db.transaction((entries) => {
      for (const entry of entries) metadataStmt.run(entry.key, entry.value)
    })
    writeMetadata([
      { key: 'source_file', value: path.basename(csvPath) },
      { key: 'table_name', value: TABLE_NAME },
      { key: 'row_count', value: String(importedCount) },
      { key: 'imported_at', value: new Date().toISOString() }
    ])

    db.pragma('optimize')

    console.log(`Imported ${importedCount} rows into ${dbPath}`)
    console.log(`Table: ${TABLE_NAME}`)
  } finally {
    db.close()
  }
}

const csvPath = resolveInputPath(process.argv[2], DEFAULT_CSV_PATH)
const dbPath = resolveInputPath(process.argv[3], DEFAULT_DB_PATH)

importCsv(csvPath, dbPath).catch((error) => {
  console.error(error.message)
  process.exit(1)
})
