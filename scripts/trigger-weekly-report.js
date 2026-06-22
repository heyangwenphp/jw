#!/usr/bin/env node

const REPORT_MODE = 'weekly-report'

process.env.REPORT_MODE = process.env.REPORT_MODE || REPORT_MODE
process.env.REPORT_TRIGGERED_BY = process.env.REPORT_TRIGGERED_BY || 'weekly-report-schedule'

const { main } = require('./trigger-lead-report-after-wechat-collection')

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
