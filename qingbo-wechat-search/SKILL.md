---
name: qingbo-wechat-search
description: Search WeChat public-account articles through the Qingbo/GSData API from the bundled default account XLSX or an overridden CSV/XLSX account list, especially when the user needs keyword retrieval across many specified official accounts, wants to test which accounts can fetch data, or needs full-coverage scanning without silently dropping accounts.
---

# Qingbo WeChat Search

## Purpose

Use this skill to search Qingbo/GSData WeChat article data for the bundled public-account list, or for a user-provided override list. The bundled script reads CSV/XLSX account tables, resolves each account to possible Qingbo `wx_name` identifiers, fetches account article metadata, optionally fetches full article content, matches keywords locally, and writes both matched articles and per-account scan status.

Bundled script:

```bash
scripts/search_wechat_accounts.py
```

Bundled default account table:

```bash
assets/清华相关微信公众号清爽总表_2026-05-13.xlsx
```

The script uses only Python standard-library modules.

## Qingbo API Rules

Use the project or user-provided `dataApi` config containing `baseUrl`, `appKey`, and `appSecret`; do not paste or repeat secrets in final responses.

Known behavior for `/weixin/article/search1`:

- `wx_name` usually means the account's WeChat ID / alias, such as `chuangplus`.
- Some accounts can be queried by `gh_xxx` original ID.
- Chinese display names and fakeid/biz values usually return empty, but may be tried for maximum recall.
- `fakeid` is useful for matching source rows to project account metadata, not normally as the direct query value.

For full-text keyword matching, fetch article content through `/weixin/article/content` using `news_local_url`.

## Workflow

1. Use the bundled account source table by default. Only pass `--accounts-source /absolute/path/to/accounts.csv_or_xlsx` when the user explicitly wants to override it. Required useful columns are `公众号名字`, `微信号`, and `fakeid`.
2. Identify the Qingbo config. If working in the current Qingbo project, run from the project root where `new/config.local.json` exists. Otherwise pass `--config /absolute/path/config.json`.
3. For maximum account coverage, include:
   - `--merge-candidates`
   - `--try-fakeid`
   - `--try-name`
4. If the user says not to filter or asks for all accounts, do not pass `--where`, `--account-name`, `--limit-accounts`, or `--exclude-personal-resume`.
5. Interpret natural date requests before running. The script accepts either strict dates or natural ranges:
   - If the user does not mention any time range, omit `--date-range`, `--start-date`, and `--end-date`; the script defaults to `近一年`.
   - Use `--date-range "近一年"` or `--date-range "一年内"` for the last year through today.
   - Other supported examples include `近半年`, `近三个月`, `30天内`, `今年`, `去年`, `本月`, `上个月`, and `2025-01-01至2025-12-31`.
   - `--start-date` and `--end-date` still accept `YYYY-MM-DD`; `--start-date "近一年"` also works and defaults the end date to today.
   - If only `--end-date` is provided, the default start date is one year before that end date.
6. Choose search fields:
   - `title,digest` is faster.
   - `title,digest,content` is slower but best for not missing keyword matches inside articles.
7. Check the status CSV after running. It contains one row per scanned source row, including candidates tried, successful candidate IDs, article count, match count, and errors.

## Full-Coverage Command

Use this shape when the user wants every account in the bundled Excel scanned and all retrievable accounts included:

```bash
python3 /Users/administrator/.codex/skills/qingbo-wechat-search/scripts/search_wechat_accounts.py \
  --config "/absolute/path/to/config.local.json" \
  --project-accounts "/absolute/path/to/accounts.json" \
  --keywords "创业,融资,机器人" \
  --date-range "近一年" \
  --chunk-days 30 \
  --search-fields title,digest,content \
  --merge-candidates \
  --try-fakeid \
  --try-name \
  --output "/absolute/path/to/wechat_keyword_matches_all.csv" \
  --status-output "/absolute/path/to/wechat_account_scan_status_all.csv" \
  --summary-output "/absolute/path/to/wechat_keyword_search_summary_all.json"
```

When running from a project root that contains `new/config.local.json` and `new/data/accounts.json`, `--config` and `--project-accounts` may be omitted.

To scan a different account table, add `--accounts-source "/absolute/path/to/accounts.xlsx"` or `--accounts-source "/absolute/path/to/accounts.csv"`.

## Current Project Defaults

For the current workspace project, run from:

```bash
/Users/administrator/Desktop/早期人才发现
```

The account source is bundled inside this skill:

```bash
/Users/administrator/.codex/skills/qingbo-wechat-search/assets/清华相关微信公众号清爽总表_2026-05-13.xlsx
```

A no-filter, maximum-recall command for that project:

```bash
cd "/Users/administrator/Desktop/早期人才发现"

python3 /Users/administrator/.codex/skills/qingbo-wechat-search/scripts/search_wechat_accounts.py \
  --keywords "创业,融资,机器人" \
  --date-range "近一年" \
  --chunk-days 30 \
  --search-fields title,digest,content \
  --merge-candidates \
  --try-fakeid \
  --try-name \
  --output new/data/wechat_keyword_matches_all.csv \
  --status-output new/data/wechat_account_scan_status_all.csv \
  --summary-output new/data/wechat_keyword_search_summary_all.json
```

Replace `--keywords`, dates, and output paths as needed.

## Output Interpretation

Matched articles CSV includes the source account row data, query ID used, article account/name, title, author, digest, publish time, URL, read/like/share counts, matched keywords, matched fields, snippet, and content length.

Status CSV is the audit file:

- `matched`: at least one fetched article matched the keywords.
- `no_match`: the account fetched articles, but none matched.
- `empty`: candidates were tried, but Qingbo returned no articles for the date window.
- `no_candidate`: the source row did not provide any usable account identifier.
- `candidates_tried`: every identifier attempted.
- `candidate_used`: the identifier or identifiers that actually returned articles.

Use the status CSV to confirm that all input rows were attempted and to isolate accounts Qingbo cannot retrieve.
