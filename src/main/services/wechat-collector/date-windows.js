const MS_PER_DAY = 24 * 60 * 60 * 1000

function assertValidDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('Invalid date value')
  }
}

function parseDateOnly(value) {
  const raw = String(value || '').trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (!match) throw new Error('Expected date in YYYY-MM-DD format')

  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  if (
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() !== Number(match[2]) - 1 ||
    date.getUTCDate() !== Number(match[3])
  ) {
    throw new Error(`Invalid date: ${raw}`)
  }
  return date
}

function formatDateOnly(date) {
  assertValidDate(date)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(date, days) {
  assertValidDate(date)
  return new Date(date.getTime() + days * MS_PER_DAY)
}

function buildDateChunks(startDate, endDate, chunkDays = 7) {
  const start = parseDateOnly(startDate)
  const end = parseDateOnly(endDate)
  const size = Number(chunkDays)
  if (!Number.isInteger(size) || size <= 0) throw new Error('chunkDays must be a positive integer')
  if (start.getTime() > end.getTime()) throw new Error('start date must be before or equal to end date')

  const chunks = []
  let cursor = start
  while (cursor.getTime() <= end.getTime()) {
    const chunkEnd = new Date(Math.min(addDays(cursor, size - 1).getTime(), end.getTime()))
    chunks.push({
      startAt: `${formatDateOnly(cursor)} 00:00:00`,
      endAt: `${formatDateOnly(chunkEnd)} 23:59:59`
    })
    cursor = addDays(chunkEnd, 1)
  }
  return chunks
}

function resolveCollectionWindow(options = {}) {
  const mode = String(options.mode || 'daily').trim().toLowerCase()
  const today = parseDateOnly(options.today || formatDateOnly(new Date()))

  if (mode === 'backfill') {
    if (!options.startDate || !options.endDate) {
      throw new Error('Backfill mode requires --start-date and --end-date')
    }
    return {
      startDate: formatDateOnly(parseDateOnly(options.startDate)),
      endDate: formatDateOnly(parseDateOnly(options.endDate))
    }
  }

  if (mode === 'daily' || mode === 'smoke') {
    const lookbackDays = Number(options.lookbackDays || (mode === 'smoke' ? 1 : 7))
    if (!Number.isInteger(lookbackDays) || lookbackDays <= 0) {
      throw new Error('lookbackDays must be a positive integer')
    }
    return {
      startDate: formatDateOnly(addDays(today, -(lookbackDays - 1))),
      endDate: formatDateOnly(today)
    }
  }

  throw new Error(`Unsupported collection mode: ${mode}`)
}

module.exports = {
  parseDateOnly,
  formatDateOnly,
  buildDateChunks,
  resolveCollectionWindow
}
