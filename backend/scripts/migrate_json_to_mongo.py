from __future__ import annotations

import argparse
import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import UpdateOne


MIGRATION_KEY = "migration:json_to_mongo:v1"


def _parse_dt(raw: str | None) -> datetime | None:
    if not raw:
        return None
    s = str(raw)
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _load_json(path: Path) -> dict[str, Any]:
    if path.is_file():
        return json.loads(path.read_text(encoding="utf-8"))
    bak = path.with_suffix(path.suffix + ".bak")
    if bak.is_file():
        return json.loads(bak.read_text(encoding="utf-8"))
    raise FileNotFoundError(f"JSON store not found at {path} or {bak}")


async def migrate(mongo_url: str, mongo_db: str, json_path: Path, dry_run: bool, backup_output: Path) -> None:
    raw = _load_json(json_path)
    backup_output.parent.mkdir(parents=True, exist_ok=True)
    backup_output.write_text(json.dumps(raw, indent=2), encoding="utf-8")

    observations = []
    for row in raw.get("observations", {}).values():
        observations.append(
            {
                "id": int(row["id"]),
                "project_id": int(row["project_id"]),
                "project_name": str(row.get("project_name", "")),
                "tower": str(row.get("tower", "")),
                "floor": str(row.get("floor", "")),
                "flat": str(row.get("flat", "")),
                "room": str(row.get("room", "")),
                "observation_type": str(row.get("observation_type", "")),
                "severity": str(row.get("severity", "")),
                "site_visit_date": row.get("site_visit_date"),
                "slab_casting_date": row.get("slab_casting_date"),
                "inspection_status": str(row.get("inspection_status", "")),
                "third_party_status": str(row.get("third_party_status", "")),
                "image_path": str(row.get("image_path", "")),
                "generated_observation": str(row.get("generated_observation", "")),
                "generated_recommendation": str(row.get("generated_recommendation", "")),
                "created_at": _parse_dt(row.get("created_at")) or datetime.now(timezone.utc),
                "cloudinary_public_id": row.get("cloudinary_public_id"),
                "cloudinary_secure_url": row.get("cloudinary_secure_url"),
                "image_uploaded_at": _parse_dt(row.get("image_uploaded_at")),
                "image_original_filename": row.get("image_original_filename"),
                "manually_written_observation": row.get("manually_written_observation") or "",
                "ai_status": str(row.get("ai_status") or "unavailable"),
                "ai_error": row.get("ai_error"),
            }
        )

    reports = []
    for row in raw.get("reports", {}).values():
        reports.append(
            {
                "id": int(row["id"]),
                "project_id": int(row["project_id"]),
                "title": str(row.get("title", "")),
                "status": str(row.get("status", "ready")),
                "pptx_path": row.get("pptx_path"),
                "pdf_path": row.get("pdf_path"),
                "xlsx_path": row.get("xlsx_path"),
                "summary": row.get("summary"),
                "error_message": row.get("error_message"),
                "created_at": _parse_dt(row.get("created_at")) or datetime.now(timezone.utc),
                "observation_ids": [int(x) for x in row.get("observation_ids", [])],
                "include_pdf": bool(row.get("include_pdf", True)),
            }
        )

    project_ops = [
        UpdateOne(
            {"key": f"project:{name}"},
            {"$set": {"key": f"project:{name}", "project_name": name, "project_id": int(pid)}},
            upsert=True,
        )
        for name, pid in raw.get("projects", {}).items()
    ]
    counter_ops = [
        UpdateOne({"key": "counter:project"}, {"$set": {"key": "counter:project", "value": int(raw.get("project_seq", 0))}}, upsert=True),
        UpdateOne({"key": "counter:observation"}, {"$set": {"key": "counter:observation", "value": int(raw.get("observation_seq", 0))}}, upsert=True),
        UpdateOne({"key": "counter:report"}, {"$set": {"key": "counter:report", "value": int(raw.get("report_seq", 0))}}, upsert=True),
    ]
    obs_ops = [UpdateOne({"id": d["id"]}, {"$set": d}, upsert=True) for d in observations]
    rep_ops = [UpdateOne({"id": d["id"]}, {"$set": d}, upsert=True) for d in reports]

    print(
        f"Prepared migration: observations={len(obs_ops)} reports={len(rep_ops)} projects={len(project_ops)} dry_run={dry_run}"
    )
    if dry_run:
        return

    client = AsyncIOMotorClient(mongo_url)
    db = client[mongo_db]
    already = await db.settings.find_one({"key": MIGRATION_KEY})
    if already:
        print("Migration marker already exists; skipping to avoid duplicates.")
        client.close()
        return

    if project_ops:
        await db.settings.bulk_write(project_ops, ordered=False)
    await db.settings.bulk_write(counter_ops, ordered=False)
    if obs_ops:
        await db.observations.bulk_write(obs_ops, ordered=False)
    if rep_ops:
        await db.reports.bulk_write(rep_ops, ordered=False)

    await db.settings.update_one(
        {"key": MIGRATION_KEY},
        {"$set": {"key": MIGRATION_KEY, "migrated_at": datetime.now(timezone.utc), "source": str(json_path)}},
        upsert=True,
    )
    print("Migration completed successfully.")
    client.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrate legacy JSON store into MongoDB.")
    parser.add_argument("--mongo-url", required=True)
    parser.add_argument("--mongo-db", default="sitelens_prod")
    parser.add_argument("--json-path", default="data/app_store.json")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--backup-output", default="data/app_store.backup.export.json")
    args = parser.parse_args()
    asyncio.run(
        migrate(
            mongo_url=args.mongo_url,
            mongo_db=args.mongo_db,
            json_path=Path(args.json_path),
            dry_run=bool(args.dry_run),
            backup_output=Path(args.backup_output),
        )
    )


if __name__ == "__main__":
    main()
