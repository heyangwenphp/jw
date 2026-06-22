#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { loadAccountSource } = require('../src/main/services/wechat-collector/account-source')
const { QingboClient } = require('../src/main/services/wechat-collector/qingbo-client')
const { WechatArticleStore } = require('../src/main/services/wechat-collector/sqlite-store')
const { runWechatCollection } = require('../src/main/services/wechat-collector/collector')
const { DeepSeekClient, normalizeDeepSeekConfig } = require('../src/main/services/wechat-collector/deepseek-client')
const { LlmFieldExtractor } = require('../src/main/services/wechat-collector/llm-field-extractor')

const ROOT_DIR = path.resolve(__dirname, '..')

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''))
}

function parseArgs(argv) {
  const args = {
    mode: 'daily',
    accountsSource: path.join(ROOT_DIR, '清华相关微信公众号表.xlsx'),
    db: path.join(ROOT_DIR, 'wechat_765.sqlite'),
    lookbackDays: 7,
    chunkDays: 7,
    pageSize: 50,
    maxPages: 20,
    delayMs: 200,
    timeoutMs: 30000,
    enableLlmFieldExtraction: true,
    llmTimeoutMs: 60000,
    llmMaxInputChars: 12000,
    enablePublicFieldEnrichment: true,
    publicSearchTimeoutMs: 15000,
    publicSearchMaxResults: 5,
    publicSearchMaxResultsPerField: 3
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--mode') args.mode = next
    else if (arg === '--config') args.config = next
    else if (arg === '--accounts-source') args.accountsSource = path.resolve(ROOT_DIR, next)
    else if (arg === '--db') args.db = path.resolve(ROOT_DIR, next)
    else if (arg === '--start-date') args.startDate = next
    else if (arg === '--end-date') args.endDate = next
    else if (arg === '--lookback-days') args.lookbackDays = Number(next)
    else if (arg === '--chunk-days') args.chunkDays = Number(next)
    else if (arg === '--limit-accounts') args.limitAccounts = Number(next)
    else if (arg === '--summary-output') args.summaryOutput = path.resolve(ROOT_DIR, next)
    else if (arg === '--page-size') args.pageSize = Number(next)
    else if (arg === '--max-pages') args.maxPages = Number(next)
    else if (arg === '--delay-ms') args.delayMs = Number(next)
    else if (arg === '--timeout-ms') args.timeoutMs = Number(next)
    else if (arg === '--enable-llm-extraction') {
      args.enableLlmFieldExtraction = true
      index -= 1
    } else if (arg === '--disable-llm-extraction') {
      args.enableLlmFieldExtraction = false
      index -= 1
    } else if (arg === '--llm-base-url') args.llmBaseUrl = next
    else if (arg === '--llm-api-key') args.llmApiKey = next
    else if (arg === '--llm-model') args.llmModel = next
    else if (arg === '--llm-timeout-ms') args.llmTimeoutMs = Number(next)
    else if (arg === '--llm-max-input-chars') args.llmMaxInputChars = Number(next)
    else if (arg === '--enable-public-enrichment') {
      args.enablePublicFieldEnrichment = true
      index -= 1
    } else if (arg === '--disable-public-enrichment') {
      args.enablePublicFieldEnrichment = false
      index -= 1
    } else if (arg === '--public-search-timeout-ms') args.publicSearchTimeoutMs = Number(next)
    else if (arg === '--public-search-max-results') args.publicSearchMaxResults = Number(next)
    else if (arg === '--public-search-max-results-per-field') args.publicSearchMaxResultsPerField = Number(next)
    else throw new Error(`Unknown argument: ${arg}`)
    index += 1
  }

  if (!args.config) {
    throw new Error('Missing --config path containing dataApi.baseUrl, dataApi.appKey, and dataApi.appSecret')
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const config = readJson(path.resolve(ROOT_DIR, args.config))
  const dataApi = config.dataApi || {}
  const accounts = loadAccountSource(args.accountsSource)
  const selectedAccounts = args.limitAccounts ? accounts.slice(0, args.limitAccounts) : accounts
  const client = new QingboClient({
    baseUrl: dataApi.baseUrl,
    appKey: dataApi.appKey,
    appSecret: dataApi.appSecret,
    delayMs: args.delayMs,
    timeoutMs: args.timeoutMs
  })
  const store = new WechatArticleStore(args.db)
  let llmFieldExtractor = null
  if (args.enableLlmFieldExtraction) {
    const deepSeekConfig = normalizeDeepSeekConfig(config)
    const deepSeekOptions = {
      ...deepSeekConfig,
      baseUrl: args.llmBaseUrl || deepSeekConfig.baseUrl,
      apiKey: args.llmApiKey || deepSeekConfig.apiKey,
      model: args.llmModel || deepSeekConfig.model,
      timeoutMs: args.llmTimeoutMs || deepSeekConfig.timeoutMs
    }
    const deepSeekClient = new DeepSeekClient(deepSeekOptions)
    llmFieldExtractor = new LlmFieldExtractor({
      client: deepSeekClient,
      model: deepSeekOptions.model,
      maxInputChars: args.llmMaxInputChars
    })
  }

  try {
    const summary = await runWechatCollection({
      mode: args.mode,
      startDate: args.startDate,
      endDate: args.endDate,
      lookbackDays: args.lookbackDays,
      chunkDays: args.chunkDays,
      pageSize: args.pageSize,
      maxPages: args.maxPages,
      llmFieldExtractor,
      enablePublicFieldEnrichment: args.enablePublicFieldEnrichment,
      publicFieldEnrichmentOptions: {
        timeoutMs: args.publicSearchTimeoutMs,
        maxResults: args.publicSearchMaxResults,
        maxResultsPerField: args.publicSearchMaxResultsPerField
      },
      accounts: selectedAccounts,
      qingboClient: client,
      store
    })
    const output = JSON.stringify(summary, null, 2)
    if (args.summaryOutput) {
      fs.mkdirSync(path.dirname(args.summaryOutput), { recursive: true })
      fs.writeFileSync(args.summaryOutput, output, 'utf8')
    }
    console.log(output)
  } finally {
    store.close()
  }
}

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
