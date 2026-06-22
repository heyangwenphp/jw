#!/usr/bin/env node

const REPORT_MODE = 'monthly-report'

process.env.REPORT_MODE = process.env.REPORT_MODE || REPORT_MODE
process.env.REPORT_TRIGGERED_BY = process.env.REPORT_TRIGGERED_BY || 'monthly-report-schedule'

const { main } = require('./trigger-lead-report-after-wechat-collection')

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
