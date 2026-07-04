from __future__ import annotations

import re
from datetime import date, timedelta


WEEKDAY_CN = {"一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "日": 6, "天": 6}
CN_NUMBER = {"一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}


def _next_weekday(reference: date, weekday: int, include_today: bool = False) -> date:
    delta = (weekday - reference.weekday()) % 7
    if delta == 0 and not include_today:
        delta = 7
    return reference + timedelta(days=delta)


def _parse_cn_number(value: str) -> int | None:
    if value.isdigit():
        return int(value)
    if value in CN_NUMBER:
        return CN_NUMBER[value]
    if value.startswith("十"):
        return 10 + CN_NUMBER.get(value[1:], 0)
    if value.endswith("十"):
        return CN_NUMBER.get(value[0], 1) * 10
    match = re.match(r"^([一二两三四五六七八九])十([一二三四五六七八九])$", value)
    if match:
        return CN_NUMBER.get(match.group(1), 0) * 10 + CN_NUMBER.get(match.group(2), 0)
    return None


def _month_day(month: int, day: int, reference: date) -> date:
    candidate = date(reference.year, month, day)
    if candidate < reference:
        candidate = date(reference.year + 1, month, day)
    return candidate


def _week_date(reference: date, token: str, mode: str) -> date:
    weekday = WEEKDAY_CN.get(token, 4)
    if mode in {"next", "after_next"}:
        days_to_next_monday = (7 - reference.weekday()) % 7 or 7
        return reference + timedelta(days=days_to_next_monday + (7 if mode == "after_next" else 0) + weekday)
    return _next_weekday(reference, weekday, include_today=(mode == "this"))


def _resolve_date_expr(text: str, reference: date, anchor: date | None = None) -> date | None:
    base = anchor or reference

    if re.search(r"大后天", text):
        return reference + timedelta(days=3)
    if re.search(r"后天", text):
        return reference + timedelta(days=2)
    if re.search(r"明天", text):
        return reference + timedelta(days=1)
    if re.search(r"今天|今日", text):
        return reference

    if re.search(r"下下周末", text):
        return _week_date(reference, "六", "after_next")
    if re.search(r"下周末", text):
        return _week_date(reference, "六", "next")
    if re.search(r"(?:这|本)周末", text):
        return _week_date(reference, "六", "this")
    if re.search(r"周末", text):
        return _week_date(reference, "六", "upcoming")

    week_match = re.search(r"下下周([一二三四五六日天])", text)
    if week_match:
        return _week_date(reference, week_match.group(1), "after_next")

    week_match = re.search(r"(?:下周|下个周|下星期|下礼拜)([一二三四五六日天])", text)
    if week_match:
        return _week_date(reference, week_match.group(1), "next")

    week_match = re.search(r"(?:这|本)周([一二三四五六日天])|(?:这|本)(?:星期|礼拜)([一二三四五六日天])", text)
    if week_match:
        return _week_date(reference, week_match.group(1) or week_match.group(2), "this")

    week_match = re.search(r"(?:周|星期|礼拜)([一二三四五六日天])", text)
    if week_match:
        resolved = _week_date(base, week_match.group(1), "upcoming")
        if anchor and resolved < anchor:
            resolved += timedelta(days=7)
        return resolved

    iso_match = re.search(r"(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})", text)
    if iso_match:
        return date(int(iso_match.group(1)), int(iso_match.group(2)), int(iso_match.group(3)))

    md_match = re.search(r"(\d{1,2})月(\d{1,2})日", text)
    if md_match:
        return _month_day(int(md_match.group(1)), int(md_match.group(2)), reference)

    short_md_match = re.search(r"(?:^|[^\d])(\d{1,2})[./-](\d{1,2})(?:$|[^\d])", text)
    if short_md_match:
        return _month_day(int(short_md_match.group(1)), int(short_md_match.group(2)), reference)

    return None


def _resolve_duration_days(message: str) -> int | None:
    duration_match = re.search(r"(\d+|[一二两三四五六七八九十]{1,3})\s*[天日]", message)
    if duration_match:
        return _parse_cn_number(duration_match.group(1))
    nights_match = re.search(r"(\d+|[一二两三四五六七八九十]{1,3})\s*晚", message)
    nights = _parse_cn_number(nights_match.group(1)) if nights_match else None
    return nights + 1 if nights else None


def resolve_relative_dates(message: str, reference: date | None = None) -> tuple[str | None, str | None]:
    ref = reference or date.today()
    date_expr = r"(?:\d{4}[年/-]\d{1,2}[月/-]\d{1,2}|\d{1,2}月\d{1,2}日|\d{1,2}[./-]\d{1,2}|下下周末|下周末|这周末|本周末|周末|下下周[一二三四五六日天]|(?:下周|下个周|下星期|下礼拜)[一二三四五六日天]|(?:这|本)周[一二三四五六日天]|(?:这|本)(?:星期|礼拜)[一二三四五六日天]|(?:周|星期|礼拜)[一二三四五六日天]|大后天|后天|明天|今天|今日)"
    range_match = re.search(rf"({date_expr})\s*(?:到|至|~|－|-|—)\s*({date_expr})", message)

    if range_match:
        start = _resolve_date_expr(range_match.group(1), ref)
        end = _resolve_date_expr(range_match.group(2), ref, start) if start else None
        return (
            start.isoformat() if start else None,
            end.isoformat() if end else None,
        )

    if re.search(r"下下周末", message):
        start = _week_date(ref, "六", "after_next")
        return start.isoformat(), (start + timedelta(days=1)).isoformat()
    if re.search(r"下周末", message):
        start = _week_date(ref, "六", "next")
        return start.isoformat(), (start + timedelta(days=1)).isoformat()
    if re.search(r"(?:这|本)周末", message):
        start = _week_date(ref, "六", "this")
        return start.isoformat(), (start + timedelta(days=1)).isoformat()
    if re.search(r"周末", message):
        start = _week_date(ref, "六", "upcoming")
        return start.isoformat(), (start + timedelta(days=1)).isoformat()

    start = _resolve_date_expr(message, ref)
    duration_days = _resolve_duration_days(message)
    end: date | None = None
    if start and duration_days:
        end = start + timedelta(days=duration_days - 1)

    return (
        start.isoformat() if start else None,
        end.isoformat() if end else None,
    )


def enrich_intent_dates(message: str, start_date: str | None, end_date: str | None) -> tuple[str | None, str | None]:
    resolved_start, resolved_end = resolve_relative_dates(message)
    final_start = start_date or resolved_start
    final_end = end_date or resolved_end
    if final_start and not final_end:
        _, inferred_end = resolve_relative_dates(message)
        final_end = inferred_end
    return final_start, final_end
