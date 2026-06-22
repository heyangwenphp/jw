#!/usr/bin/env python3
"""
Search WeChat public-account articles from the bundled account table, or an
overridden account table, via the Qingbo API.

Example:
  python3 new/scripts/search_wechat_accounts.py \
    --keywords "创业,融资,机器人" \
    --date-range "近一年" \
    --search-fields title,digest,content \
    --output data/wechat_keyword_matches.csv

The script resolves each account by trying:
  1. 微信号 / 原始alias
  2. Existing project account id from new/data/accounts.json, matched by name or fakeid/biz
  3. display name / fakeid only when --try-name or --try-fakeid is passed
"""

from __future__ import annotations

import argparse
import base64
import calendar
import csv
import datetime as dt
import hashlib
import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET


DEFAULT_CONFIG = "new/config.local.json"
DEFAULT_PROJECT_ACCOUNTS = "new/data/accounts.json"
SKILL_DIR = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = str(SKILL_DIR / "assets" / "清华相关微信公众号清爽总表_2026-05-13.xlsx")
DEFAULT_DATE_RANGE = "近一年"

ACCOUNT_NAME_FIELD = "公众号名字"
WECHAT_ID_FIELD = "微信号"
FAKEID_FIELD = "fakeid"
RAW_ALIAS_FIELD = "原始alias"
INTRO_FIELD = "公众号介绍"


def compact(value: Any) -> str:
    return str(value or "").strip()


def read_csv_table(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return [dict(row) for row in csv.DictReader(handle)]


def excel_col_index(cell_ref: str) -> int:
    letters = "".join(ch for ch in cell_ref if ch.isalpha())
    value = 0
    for ch in letters:
        value = value * 26 + (ord(ch.upper()) - ord("A") + 1)
    return value - 1


def read_xlsx_table(path: Path) -> list[dict[str, str]]:
    # Minimal XLSX reader for simple worksheet tables. This avoids external
    # dependencies on machines without pandas/openpyxl.
    with zipfile.ZipFile(path) as archive:
        shared_strings: list[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            ns = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
            for item in root.findall("x:si", ns):
                pieces = [node.text or "" for node in item.findall(".//x:t", ns)]
                shared_strings.append("".join(pieces))

        sheet_name = "xl/worksheets/sheet1.xml"
        if sheet_name not in archive.namelist():
            candidates = sorted(name for name in archive.namelist() if name.startswith("xl/worksheets/sheet"))
            if not candidates:
                raise ValueError(f"No worksheet found in {path}")
            sheet_name = candidates[0]

        root = ET.fromstring(archive.read(sheet_name))

    ns = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    rows: list[list[str]] = []
    for row in root.findall(".//x:sheetData/x:row", ns):
        values: dict[int, str] = {}
        for cell in row.findall("x:c", ns):
            ref = cell.attrib.get("r", "")
            col = excel_col_index(ref)
            cell_type = cell.attrib.get("t", "")
            value = ""
            if cell_type == "inlineStr":
                value = "".join(node.text or "" for node in cell.findall(".//x:t", ns))
            else:
                node = cell.find("x:v", ns)
                raw = node.text if node is not None else ""
                if cell_type == "s" and raw:
                    value = shared_strings[int(raw)]
                else:
                    value = raw or ""
            values[col] = value
        if values:
            max_col = max(values)
            rows.append([values.get(index, "") for index in range(max_col + 1)])

    if not rows:
        return []
    headers = [compact(item) for item in rows[0]]
    return [
        {headers[index]: compact(value) for index, value in enumerate(row) if index < len(headers)}
        for row in rows[1:]
        if any(compact(value) for value in row)
    ]


def read_account_table(path: Path) -> list[dict[str, str]]:
    suffix = path.suffix.lower()
    if suffix == ".csv":
        return read_csv_table(path)
    if suffix == ".xlsx":
        return read_xlsx_table(path)
    raise ValueError(f"Unsupported account source type: {path.suffix}. Use .csv or .xlsx.")


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def build_access_token(app_key: str, app_secret: str, router: str, params: dict[str, Any]) -> str:
    sorted_params = "".join(
        f"{key}{params[key]}"
        for key in sorted(params)
        if params[key] is not None and params[key] != ""
    )
    sign = hashlib.md5(f"{app_secret}_{sorted_params}_{app_secret}".encode("utf-8")).hexdigest()
    return base64.b64encode(f"{app_key}:{sign}:{router}".encode("utf-8")).decode("ascii")


class QingboClient:
    def __init__(self, base_url: str, app_key: str, app_secret: str, timeout: int = 30, delay: float = 0.2):
        self.base_url = base_url
        self.app_key = app_key
        self.app_secret = app_secret
        self.timeout = timeout
        self.delay = delay

    def get(self, router: str, params: dict[str, Any]) -> dict[str, Any]:
        query = urllib.parse.urlencode({key: value for key, value in params.items() if value not in (None, "")})
        url = f"{self.base_url}?{query}"
        token = build_access_token(self.app_key, self.app_secret, router, params)
        request = urllib.request.Request(url, headers={"access-token": token})
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                payload = response.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"HTTP {error.code}: {body[:300]}") from error
        finally:
            if self.delay > 0:
                time.sleep(self.delay)
        return json.loads(payload)

    def search_account_articles(
        self,
        wx_name: str,
        start_at: str,
        end_at: str,
        page_size: int = 50,
        max_pages: int = 20,
    ) -> tuple[list[dict[str, Any]], int, bool]:
        router = "/weixin/article/search1"
        articles: list[dict[str, Any]] = []
        num_found = 0
        truncated = False
        for page in range(1, max_pages + 1):
            params = {
                "wx_name": wx_name,
                "posttime_start": start_at,
                "posttime_end": end_at,
                "order": "desc",
                "sort": "posttime",
                "page": page,
                "limit": page_size,
            }
            payload = self.get(router, params)
            if payload.get("success") is not True:
                raise RuntimeError(payload.get("message") or payload.get("msg") or "Qingbo article search failed")
            news_list = payload.get("data", {}).get("newsList") or []
            num_found = int(payload.get("data", {}).get("numFound") or len(news_list) or num_found)
            articles.extend(news_list)
            if len(articles) >= num_found or len(news_list) < page_size:
                break
        if num_found and len(articles) < num_found:
            truncated = True
        return articles, num_found, truncated

    def fetch_article_content(self, news_local_url: str) -> str:
        if not news_local_url:
            return ""
        router = "/weixin/article/content"
        payload = self.get(router, {"news_local_url": news_local_url})
        if payload.get("success") is not True:
            return ""
        return strip_html(payload.get("data", {}).get("news_content") or "")


def strip_html(value: str) -> str:
    value = re.sub(r"<script[\s\S]*?</script>", " ", value, flags=re.I)
    value = re.sub(r"<style[\s\S]*?</style>", " ", value, flags=re.I)
    value = re.sub(r"<[^>]+>", " ", value)
    value = html.unescape(value)
    return re.sub(r"\s+", " ", value).strip()


CHINESE_NUMBER_VALUES = {
    "零": 0,
    "一": 1,
    "二": 2,
    "两": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
}
NUMBER_PATTERN = r"[0-9一二三四五六七八九十两半个]+"
ABSOLUTE_DATE_PATTERN = r"\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?"


def normalize_date_text(value: str) -> str:
    return re.sub(r"\s+", "", compact(value))


def parse_chinese_number(value: str) -> int:
    value = normalize_date_text(value).replace("个", "")
    if value.isdigit():
        return int(value)
    if value in CHINESE_NUMBER_VALUES:
        return CHINESE_NUMBER_VALUES[value]
    if "十" in value:
        left, _, right = value.partition("十")
        tens = parse_chinese_number(left) if left else 1
        ones = parse_chinese_number(right) if right else 0
        return tens * 10 + ones
    raise ValueError(f"Unsupported Chinese number: {value}")


def subtract_months(value: dt.date, months: int) -> dt.date:
    month_index = value.year * 12 + value.month - 1 - months
    year = month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return dt.date(year, month, day)


def parse_absolute_date(value: str) -> dt.date | None:
    text = normalize_date_text(value)
    match = re.fullmatch(r"(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?", text)
    if not match:
        return None
    try:
        return dt.date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    except ValueError as error:
        raise argparse.ArgumentTypeError(f"Invalid date {value!r}") from error


def parse_natural_start_date(value: str, today: dt.date) -> dt.date | None:
    text = normalize_date_text(value)
    if text in {"今天", "今日"}:
        return today
    if text == "昨天":
        return today - dt.timedelta(days=1)
    if text == "前天":
        return today - dt.timedelta(days=2)
    if text in {"今年", "本年"}:
        return dt.date(today.year, 1, 1)
    if text in {"本月", "这个月"}:
        return dt.date(today.year, today.month, 1)
    if text in {"本周", "这周"}:
        return today - dt.timedelta(days=today.weekday())
    if text in {"近半年", "最近半年", "过去半年", "半年内", "半年以来"}:
        return subtract_months(today, 6)

    match = re.fullmatch(rf"(?:近|最近|过去)?(?P<num>{NUMBER_PATTERN})(?P<unit>年|个月|月|周|星期|天|日)(?:内|以来)?", text)
    if not match:
        return None

    number_text = match.group("num")
    unit = match.group("unit")
    if number_text == "半":
        if unit == "年":
            return subtract_months(today, 6)
        raise argparse.ArgumentTypeError(f"Unsupported relative date {value!r}")

    amount = parse_chinese_number(number_text)
    if amount <= 0:
        raise argparse.ArgumentTypeError(f"Relative date amount must be positive: {value!r}")
    if unit == "年":
        return subtract_months(today, amount * 12)
    if unit in {"个月", "月"}:
        return subtract_months(today, amount)
    if unit in {"周", "星期"}:
        return today - dt.timedelta(days=amount * 7)
    return today - dt.timedelta(days=amount)


def parse_date_argument(value: str, today: dt.date | None = None) -> dt.date:
    today = today or dt.date.today()
    absolute = parse_absolute_date(value)
    if absolute:
        return absolute
    natural = parse_natural_start_date(value, today)
    if natural:
        return natural
    raise argparse.ArgumentTypeError(
        f"Invalid date {value!r}; use YYYY-MM-DD or expressions like 今天, 昨天, 近一年, 一年内, 近三个月, 30天内."
    )


def parse_date_range(value: str, today: dt.date | None = None) -> tuple[dt.date, dt.date]:
    today = today or dt.date.today()
    text = normalize_date_text(value)
    absolute_dates = re.findall(ABSOLUTE_DATE_PATTERN, text)
    if len(absolute_dates) >= 2:
        return parse_date_argument(absolute_dates[0], today), parse_date_argument(absolute_dates[1], today)

    if text in {"去年", "上年"}:
        year = today.year - 1
        return dt.date(year, 1, 1), dt.date(year, 12, 31)
    if text in {"上月", "上个月"}:
        last_day = dt.date(today.year, today.month, 1) - dt.timedelta(days=1)
        return dt.date(last_day.year, last_day.month, 1), last_day
    if text in {"今年", "本年"}:
        return dt.date(today.year, 1, 1), today
    if text in {"本月", "这个月"}:
        return dt.date(today.year, today.month, 1), today
    if text in {"本周", "这周"}:
        return today - dt.timedelta(days=today.weekday()), today

    return parse_date_argument(value, today), today


def resolve_date_options(args: argparse.Namespace) -> tuple[dt.date, dt.date]:
    today = dt.date.today()
    if args.date_range:
        start_date, end_date = parse_date_range(args.date_range, today)
        if args.start_date:
            start_date = parse_date_argument(args.start_date, today)
        if args.end_date:
            end_date = parse_date_argument(args.end_date, today)
    else:
        if args.start_date:
            start_date = parse_date_argument(args.start_date, today)
            end_date = parse_date_argument(args.end_date, today) if args.end_date else today
        elif args.end_date:
            end_date = parse_date_argument(args.end_date, today)
            start_date, _ = parse_date_range(DEFAULT_DATE_RANGE, end_date)
        else:
            start_date, end_date = parse_date_range(DEFAULT_DATE_RANGE, today)

    if start_date > end_date:
        raise argparse.ArgumentTypeError("start date must be before or equal to end date")
    return start_date, end_date


def iter_date_chunks(start: dt.date, end: dt.date, chunk_days: int) -> list[tuple[str, str]]:
    if start > end:
        raise ValueError("start-date must be before or equal to end-date")
    chunks: list[tuple[str, str]] = []
    cursor = start
    while cursor <= end:
        chunk_end = min(end, cursor + dt.timedelta(days=max(1, chunk_days) - 1))
        chunks.append((f"{cursor.isoformat()} 00:00:00", f"{chunk_end.isoformat()} 23:59:59"))
        cursor = chunk_end + dt.timedelta(days=1)
    return chunks


def split_keywords(values: list[str] | None) -> list[str]:
    keywords: list[str] = []
    for value in values or []:
        for piece in re.split(r"[,，\n]", value):
            piece = compact(piece)
            if piece:
                keywords.append(piece)
    return list(dict.fromkeys(keywords))


def normalize_for_match(value: str) -> str:
    return value.casefold()


def match_keywords(fields: dict[str, str], keywords: list[str], mode: str) -> tuple[list[str], list[str]]:
    haystack_by_field = {field: normalize_for_match(text) for field, text in fields.items()}
    matched_keywords: list[str] = []
    matched_fields: set[str] = set()
    for keyword in keywords:
        needle = normalize_for_match(keyword)
        field_hits = [field for field, haystack in haystack_by_field.items() if needle in haystack]
        if field_hits:
            matched_keywords.append(keyword)
            matched_fields.update(field_hits)
    if mode == "all" and len(matched_keywords) != len(keywords):
        return [], []
    return matched_keywords, sorted(matched_fields)


def build_snippet(fields: dict[str, str], keywords: list[str], width: int = 80) -> str:
    for field in ("title", "digest", "content"):
        text = fields.get(field, "")
        folded = normalize_for_match(text)
        for keyword in keywords:
            index = folded.find(normalize_for_match(keyword))
            if index >= 0:
                start = max(0, index - width)
                end = min(len(text), index + len(keyword) + width)
                prefix = "..." if start else ""
                suffix = "..." if end < len(text) else ""
                return f"{prefix}{text[start:end]}{suffix}"
    return ""


def article_key(article: dict[str, Any]) -> str:
    return "|".join(
        compact(article.get(key))
        for key in ("news_uuid", "news_url", "news_title", "news_posttime")
    )


def project_account_indexes(path: Path) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    if not path.exists():
        return {}, {}
    accounts = load_json(path)
    by_name = {compact(account.get("name")): account for account in accounts if compact(account.get("name"))}
    by_biz = {compact(account.get("biz")): account for account in accounts if compact(account.get("biz"))}
    return by_name, by_biz


def add_candidate(candidates: list[dict[str, str]], kind: str, value: str) -> None:
    value = compact(value)
    if not value:
        return
    if any(item["value"] == value for item in candidates):
        return
    candidates.append({"kind": kind, "value": value})


def resolve_candidates(
    row: dict[str, str],
    project_by_name: dict[str, dict[str, Any]],
    project_by_biz: dict[str, dict[str, Any]],
    try_fakeid: bool,
    try_name: bool,
) -> list[dict[str, str]]:
    name = compact(row.get(ACCOUNT_NAME_FIELD))
    fakeid = compact(row.get(FAKEID_FIELD))
    candidates: list[dict[str, str]] = []
    add_candidate(candidates, "wechat_id", row.get(WECHAT_ID_FIELD, ""))
    add_candidate(candidates, "raw_alias", row.get(RAW_ALIAS_FIELD, ""))

    project = project_by_name.get(name)
    if project:
        add_candidate(candidates, "project_id_by_name", project.get("id", ""))

    project = project_by_biz.get(fakeid)
    if project:
        add_candidate(candidates, "project_id_by_fakeid_biz", project.get("id", ""))

    if try_name:
        add_candidate(candidates, "display_name", name)
    if try_fakeid:
        add_candidate(candidates, "fakeid", fakeid)
    return candidates


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def write_csv(path: Path, rows: list[dict[str, Any]], fieldnames: list[str]) -> None:
    ensure_parent(path)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Search Qingbo WeChat articles in the bundled or specified account table.")
    parser.add_argument("--accounts-source", default=DEFAULT_SOURCE, help="CSV/XLSX account source table. Defaults to the bundled skill account table.")
    parser.add_argument("--config", default=DEFAULT_CONFIG, help="JSON config containing dataApi credentials.")
    parser.add_argument("--project-accounts", default=DEFAULT_PROJECT_ACCOUNTS, help="Existing project accounts JSON for gh_xxx fallback.")
    parser.add_argument("--keywords", action="append", required=True, help="Keywords, comma/newline separated. Can be passed multiple times.")
    parser.add_argument("--match", choices=["any", "all"], default="any", help="Match any keyword or require all keywords.")
    parser.add_argument("--date-range", help=f"Date range expression, for example: 近一年, 一年内, 近三个月, 30天内, 今年, 去年, 2025-01-01至2025-12-31. Defaults to {DEFAULT_DATE_RANGE}.")
    parser.add_argument("--start-date", help=f"Start date as YYYY-MM-DD or a natural expression like 近一年, 一年内, 近三个月. Defaults to {DEFAULT_DATE_RANGE} when no date is provided.")
    parser.add_argument("--end-date", help="End date as YYYY-MM-DD or a natural date like 今天, 昨天. Defaults to today.")
    parser.add_argument("--chunk-days", type=int, default=30, help="Days per API query window. Use 1 for safest full backfill.")
    parser.add_argument("--search-fields", default="title,digest,content", help="Comma-separated: title,digest,content.")
    parser.add_argument("--where", action="append", help="Filter source rows by exact column match, for example: --where 是否主清单=是. Repeatable.")
    parser.add_argument("--exclude-personal-resume", action="store_true", help="Skip rows where 是否个人履历号 is 是.")
    parser.add_argument("--account-name", action="append", help="Only scan accounts whose name contains this text. Repeatable.")
    parser.add_argument("--limit-accounts", type=int, default=0, help="Limit account count for smoke tests.")
    parser.add_argument("--page-size", type=int, default=50, help="Qingbo page size, max recommended 50.")
    parser.add_argument("--max-pages", type=int, default=20, help="Max pages per account per chunk.")
    parser.add_argument("--delay", type=float, default=0.2, help="Delay after each API request in seconds.")
    parser.add_argument("--timeout", type=int, default=30, help="HTTP timeout in seconds.")
    parser.add_argument("--merge-candidates", action="store_true", help="Try all resolved account identifiers and merge article results. Slower but best recall.")
    parser.add_argument("--try-fakeid", action="store_true", help="Also try fakeid as wx_name. Usually returns empty for this API.")
    parser.add_argument("--try-name", action="store_true", help="Also try display name as wx_name. Usually returns empty for this API.")
    parser.add_argument("--output", default="wechat_keyword_matches.csv", help="Matched articles CSV.")
    parser.add_argument("--status-output", default="wechat_account_scan_status.csv", help="Per-account status CSV.")
    parser.add_argument("--summary-output", default="wechat_keyword_search_summary.json", help="JSON summary.")
    return parser


def main() -> int:
    args = build_argument_parser().parse_args()
    keywords = split_keywords(args.keywords)
    if not keywords:
        raise SystemExit("At least one keyword is required.")
    try:
        args.start_date, args.end_date = resolve_date_options(args)
    except argparse.ArgumentTypeError as error:
        raise SystemExit(str(error)) from error

    source_path = Path(args.accounts_source)
    config_path = Path(args.config)
    project_accounts_path = Path(args.project_accounts)
    config = load_json(config_path)
    data_api = config.get("dataApi") or {}
    required = ["baseUrl", "appKey", "appSecret"]
    missing = [key for key in required if not compact(data_api.get(key))]
    if missing:
        raise SystemExit(f"Missing dataApi config keys in {config_path}: {', '.join(missing)}")

    rows = read_account_table(source_path)
    if args.where:
        for condition in args.where:
            if "=" not in condition:
                raise SystemExit(f"Invalid --where {condition!r}; expected COLUMN=VALUE")
            column, expected = [compact(item) for item in condition.split("=", 1)]
            rows = [row for row in rows if compact(row.get(column)) == expected]
    if args.exclude_personal_resume:
        rows = [row for row in rows if compact(row.get("是否个人履历号")) != "是"]
    if args.account_name:
        filters = [normalize_for_match(item) for item in args.account_name]
        rows = [
            row for row in rows
            if any(text in normalize_for_match(compact(row.get(ACCOUNT_NAME_FIELD))) for text in filters)
        ]
    if args.limit_accounts:
        rows = rows[: args.limit_accounts]

    project_by_name, project_by_biz = project_account_indexes(project_accounts_path)
    client = QingboClient(
        data_api["baseUrl"],
        data_api["appKey"],
        data_api["appSecret"],
        timeout=args.timeout,
        delay=args.delay,
    )
    chunks = iter_date_chunks(args.start_date, args.end_date, args.chunk_days)
    search_fields = {compact(item) for item in args.search_fields.split(",") if compact(item)}
    valid_fields = {"title", "digest", "content"}
    unknown_fields = search_fields - valid_fields
    if unknown_fields:
        raise SystemExit(f"Unknown search fields: {', '.join(sorted(unknown_fields))}")
    fetch_content = "content" in search_fields

    matches: list[dict[str, Any]] = []
    statuses: list[dict[str, Any]] = []
    content_cache: dict[str, str] = {}

    for index, row in enumerate(rows, start=1):
        account_name = compact(row.get(ACCOUNT_NAME_FIELD))
        fakeid = compact(row.get(FAKEID_FIELD))
        candidates = resolve_candidates(row, project_by_name, project_by_biz, args.try_fakeid, args.try_name)
        status = {
            "source_row_number": index,
            "source_account_name": account_name,
            "source_wechat_id": compact(row.get(WECHAT_ID_FIELD)),
            "source_fakeid": fakeid,
            "candidates_tried": "",
            "candidate_used": "",
            "candidate_kind": "",
            "status": "unresolved",
            "article_count_scanned": 0,
            "match_count": 0,
            "truncated": "",
            "error": "",
        }

        print(f"[{index}/{len(rows)}] {account_name}", file=sys.stderr)
        all_articles: dict[str, dict[str, Any]] = {}
        attempted_candidates: list[dict[str, str]] = []
        selected_candidates: list[dict[str, str]] = []
        errors: list[str] = []
        truncated_chunks = 0

        for candidate in candidates:
            attempted_candidates.append(candidate)
            candidate_articles: dict[str, dict[str, Any]] = {}
            candidate_truncated = 0
            try:
                for start_at, end_at in chunks:
                    articles, _, truncated = client.search_account_articles(
                        candidate["value"],
                        start_at,
                        end_at,
                        page_size=args.page_size,
                        max_pages=args.max_pages,
                    )
                    if truncated:
                        candidate_truncated += 1
                    for article in articles:
                        candidate_articles[article_key(article)] = article
            except Exception as error:  # noqa: BLE001 - CLI should continue scanning other accounts.
                errors.append(f"{candidate['kind']}={candidate['value']}: {error}")
                continue

            if candidate_articles:
                selected_candidates.append(candidate)
                all_articles.update(candidate_articles)
                truncated_chunks += candidate_truncated
                if not args.merge_candidates:
                    break

        status["candidates_tried"] = " | ".join(f"{item['kind']}={item['value']}" for item in attempted_candidates)
        if not selected_candidates:
            status["status"] = "empty" if candidates else "no_candidate"
            status["error"] = " | ".join(errors)
            statuses.append(status)
            continue

        status["candidate_used"] = " | ".join(item["value"] for item in selected_candidates)
        status["candidate_kind"] = " | ".join(item["kind"] for item in selected_candidates)
        status["article_count_scanned"] = len(all_articles)
        status["truncated"] = str(truncated_chunks) if truncated_chunks else ""

        account_matches = 0
        for article in all_articles.values():
            title = compact(article.get("news_title"))
            digest = compact(article.get("news_digest"))
            content = ""
            if fetch_content:
                local_url = compact(article.get("news_local_url"))
                if local_url not in content_cache:
                    try:
                        content_cache[local_url] = client.fetch_article_content(local_url)
                    except Exception as error:  # noqa: BLE001
                        content_cache[local_url] = ""
                        errors.append(f"content {local_url}: {error}")
                content = content_cache.get(local_url, "")

            field_text = {
                "title": title if "title" in search_fields else "",
                "digest": digest if "digest" in search_fields else "",
                "content": content if "content" in search_fields else "",
            }
            matched_keywords, matched_fields = match_keywords(field_text, keywords, args.match)
            if not matched_keywords:
                continue

            account_matches += 1
            matches.append({
                "source_account_name": account_name,
                "source_wechat_id": compact(row.get(WECHAT_ID_FIELD)),
                "source_fakeid": fakeid,
                "query_id_used": status["candidate_used"],
                "query_id_type": status["candidate_kind"],
                "article_account": compact(article.get("wx_nickname")) or account_name,
                "article_wx_name": compact(article.get("wx_name")),
                "title": title,
                "author": compact(article.get("news_author")) or compact(article.get("author_name")),
                "digest": digest,
                "published_at": compact(article.get("news_posttime")),
                "url": compact(article.get("news_url")),
                "news_uuid": compact(article.get("news_uuid")),
                "news_local_url": compact(article.get("news_local_url")),
                "read_count": compact(article.get("news_read_count")),
                "like_count": compact(article.get("news_like_count")),
                "share_count": compact(article.get("share_num")),
                "matched_keywords": " | ".join(matched_keywords),
                "matched_fields": " | ".join(matched_fields),
                "snippet": build_snippet(field_text, matched_keywords),
                "content_fetched": str(bool(fetch_content)),
                "content_length": len(content),
            })

        status["match_count"] = account_matches
        status["status"] = "matched" if account_matches else "no_match"
        status["error"] = " | ".join(errors)
        statuses.append(status)

    match_fields = [
        "source_account_name",
        "source_wechat_id",
        "source_fakeid",
        "query_id_used",
        "query_id_type",
        "article_account",
        "article_wx_name",
        "title",
        "author",
        "digest",
        "published_at",
        "url",
        "news_uuid",
        "news_local_url",
        "read_count",
        "like_count",
        "share_count",
        "matched_keywords",
        "matched_fields",
        "snippet",
        "content_fetched",
        "content_length",
    ]
    status_fields = [
        "source_row_number",
        "source_account_name",
        "source_wechat_id",
        "source_fakeid",
        "candidates_tried",
        "candidate_used",
        "candidate_kind",
        "status",
        "article_count_scanned",
        "match_count",
        "truncated",
        "error",
    ]
    write_csv(Path(args.output), matches, match_fields)
    write_csv(Path(args.status_output), statuses, status_fields)

    summary = {
        "accounts_source": str(source_path),
        "account_count": len(rows),
        "keywords": keywords,
        "match_mode": args.match,
        "search_fields": sorted(search_fields),
        "start_date": args.start_date.isoformat(),
        "end_date": args.end_date.isoformat(),
        "chunk_days": args.chunk_days,
        "match_count": len(matches),
        "matched_account_count": sum(1 for item in statuses if item["status"] == "matched"),
        "empty_account_count": sum(1 for item in statuses if item["status"] in {"empty", "no_candidate"}),
        "no_match_account_count": sum(1 for item in statuses if item["status"] == "no_match"),
        "output": args.output,
        "status_output": args.status_output,
    }
    ensure_parent(Path(args.summary_output))
    Path(args.summary_output).write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
