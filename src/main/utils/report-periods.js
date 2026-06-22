const {
  DAILY_LEAD_REPORT_MODE,
  MONTHLY_REPORT_MODE,
  WEEKLY_REPORT_MODE
} = require('./report-prompts')

function toDate(value = new Date()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('Invalid report reference date')
  return date
}

function startOfLocalDay(value) {
  const date = toDate(value)
  date.setHours(0, 0, 0, 0)
  return date
}

function endOfLocalDay(value) {
  const date = startOfLocalDay(value)
  date.setHours(23, 59, 59, 999)
  return date
}

function addDays(value, days) {
  const date = toDate(value)
  date.setDate(date.getDate() + days)
  return date
}

function formatChineseDate(value) {
  const date = toDate(value)
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

function formatChineseMonth(value) {
  const date = toDate(value)
  return `${date.getFullYear()}年${date.getMonth() + 1}月`
}

function buildDailyPeriod(referenceDate) {
  const day = startOfLocalDay(addDays(referenceDate, -1))
  const label = formatChineseDate(day)
  return {
    periodStart: startOfLocalDay(day),
    periodEnd: endOfLocalDay(day),
    periodLabel: label,
    title: `日报(${label})`,
    fileName: `日报(${label}).md`
  }
}

function buildWeeklyPeriod(referenceDate) {
  const ref = startOfLocalDay(referenceDate)
  const day = ref.getDay()
  const daysSinceFriday = (day + 2) % 7
  const end = startOfLocalDay(addDays(ref, -daysSinceFriday))
  const start = startOfLocalDay(addDays(end, -6))
  const label = `${formatChineseDate(start)}-${formatChineseDate(end)}`
  return {
    periodStart: start,
    periodEnd: endOfLocalDay(end),
    periodLabel: label,
    title: `周报(${label})`,
    fileName: `周报(${label}).md`
  }
}

function buildMonthlyPeriod(referenceDate) {
  const ref = startOfLocalDay(referenceDate)
  const monthStart = new Date(ref.getFullYear(), ref.getMonth() - 1, 1)
  const monthEnd = new Date(ref.getFullYear(), ref.getMonth(), 0, 23, 59, 59, 999)
  const label = formatChineseMonth(monthStart)
  return {
    periodStart: monthStart,
    periodEnd: monthEnd,
    periodLabel: label,
    title: `月报(${label})`,
    fileName: `月报(${label}).md`
  }
}

function buildReportPeriod(mode, referenceDate = new Date()) {
  const normalizedMode = String(mode || DAILY_LEAD_REPORT_MODE)
  const base = normalizedMode === WEEKLY_REPORT_MODE
    ? buildWeeklyPeriod(referenceDate)
    : normalizedMode === MONTHLY_REPORT_MODE
      ? buildMonthlyPeriod(referenceDate)
      : buildDailyPeriod(referenceDate)

  return {
    mode: normalizedMode,
    ...base,
    periodStartIso: base.periodStart.toISOString(),
    periodEndIso: base.periodEnd.toISOString()
  }
}

module.exports = {
  buildReportPeriod,
  formatChineseDate,
  formatChineseMonth
}
