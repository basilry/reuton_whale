from datetime import datetime, timezone


def dict_to_row(data: dict, headers: list[str]) -> list[str]:
    row = []
    for h in headers:
        val = data.get(h, "")
        if isinstance(val, (list, dict)):
            import json
            val = json.dumps(val, ensure_ascii=False)
        row.append(str(val) if val is not None else "")
    return row


def row_to_dict(row: list[str], headers: list[str]) -> dict:
    result = {}
    for i, h in enumerate(headers):
        result[h] = row[i] if i < len(row) else ""
    return result


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
