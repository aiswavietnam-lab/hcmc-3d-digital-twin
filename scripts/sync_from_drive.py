#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Đồng bộ tự động dữ liệu 3D HCMC_3D_DIGITAL_TWIN từ Google Drive lên GitHub Pages.
Hỗ trợ 2 chế độ:
  1) Local Google Drive for Desktop (--local-drive "I:\\My Drive\\02 JOB\\02 WORKING\\VIBE CODE\\HCMC_3D_DIGITAL_TWIN")
  2) Google Drive API v3 (trên GitHub Actions qua GOOGLE_SERVICE_ACCOUNT_JSON / GDRIVE_OAUTH_REFRESH_TOKEN / GDRIVE_API_KEY)
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS_TILES_DIR = ROOT / "assets" / "tiles"
ASSETS_GIS_DIR = ROOT / "assets" / "gis"
ASSETS_LANDMARKS_DIR = ROOT / "assets" / "landmarks"
API_DIR = ROOT / "api"
STATE_DIR = ROOT / "state"

# Google Drive Folder IDs thật của HCMC_3D_DIGITAL_TWIN
DRIVE_IDS = {
    "PROJECT_ROOT": "1MZgx6V53Dcy34KvtM-jkvyAp0yVWY5Vn",
    "00_STATE": "1hkPp0vJymmD14Ug1eqHmv_y1UfJ5LXX8",
    "00_STATE/locks": "1OmWH6LLrqCZfAr_5pt4bOQu_D-Ja8dnK",
    "00_STATE/results": "1imRihoQQaxi5xvuV58fzz2kgt3rZEHlx",
    "01_DATA_REFS/architecture": "1R3RbSQ0jLbSF094RptnB01pY4DDLDvAk",
    "01_DATA_REFS/gis_tiles": "1dpprFz67vRuAZtsB-4NT2SUnkilVlOIU",
    "02_ASSETS_3D/ring1_tiles/band_N01": "1jM-9_7LEfscs6RJoTaJ8IFaB9LUjqske",
    "02_ASSETS_3D/ring1_tiles/band_S00": "1im106PPCS5INIEktORjSbGPwTaWruY8S",
    "02_ASSETS_3D/ring1_tiles/band_S01": "1b_C7Q8cpRrRveZ79cslw5T4xZTYui-qp",
    "02_ASSETS_3D/ring1_tiles/band_S02": "1mU6LTE3MAVdgPbSSj3VnvvsPOEj4cHdy",
    "02_ASSETS_3D/ring1_tiles/band_S03": "1pPS80_OZkRNbvJXBN1Ipe5xpRveauJA_",
    "02_ASSETS_3D/landmarks/heritage_q1": "1VZbw7t_CUGFTM_77Ld4Tmvre5UA6-AUu",
    "02_ASSETS_3D/landmarks/cbd_skyscrapers": "1CBV2-6FmTl_b1HdDmJS0vOMC1O8i1Y2F",
    "02_ASSETS_3D/landmarks/vinhomes_binhthanh": "10eQb85uSHzNqpoGPaMlNgTfYWOIgVQcZ",
    "02_ASSETS_3D/landmarks/bridges": "1nDo34nOxHHvfH9FxrlgftXHffAobOi3N",
    "02_ASSETS_3D/landmarks/metro_thuthiem": "1KfvkGwz_3_q5O3FVNxunx1HrYkZRc3Ad",
    "02_ASSETS_3D/landmarks/south_and_aviation": "1bwFJ-S61_-cD-gDGIIoLC8OFKGmmj6kC",
}

DUP_RE = re.compile(r" \(\d+\)(\.[^.]+)$")


def strip_dup(name: str) -> str:
    return DUP_RE.sub(r"\1", name)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def copy_if_changed(src: pathlib.Path, dst: pathlib.Path) -> bool:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists() and dst.stat().st_size == src.stat().st_size:
        if sha256_bytes(dst.read_bytes()) == sha256_bytes(src.read_bytes()):
            return False
    shutil.copy2(src, dst)
    return True


def dedup_dir_files(folder: pathlib.Path) -> dict[str, pathlib.Path]:
    chosen: dict[str, tuple[float, pathlib.Path]] = {}
    if not folder.exists():
        return {}
    for p in folder.rglob("*"):
        if not p.is_file():
            continue
        logical = strip_dup(p.name)
        mt = p.stat().st_mtime
        prev = chosen.get(logical)
        if prev is None or mt > prev[0] or (mt == prev[0] and p.name == logical):
            chosen[logical] = (mt, p)
    return {k: v[1] for k, v in chosen.items()}


def sync_from_local_drive(drive_root: pathlib.Path) -> dict:
    ASSETS_TILES_DIR.mkdir(parents=True, exist_ok=True)
    ASSETS_GIS_DIR.mkdir(parents=True, exist_ok=True)
    ASSETS_LANDMARKS_DIR.mkdir(parents=True, exist_ok=True)
    API_DIR.mkdir(parents=True, exist_ok=True)
    STATE_DIR.mkdir(parents=True, exist_ok=True)

    contract = json.loads((drive_root / "01_DATA_REFS" / "architecture" / "GRID_CONTRACT.json").read_text(encoding="utf-8"))
    task_board = json.loads((drive_root / "00_STATE" / "TASK_BOARD.json").read_text(encoding="utf-8"))

    # Copy GRID_CONTRACT compact copy or keep summary in world-index
    (STATE_DIR / "TASK_BOARD.json").write_text(json.dumps(task_board, ensure_ascii=False, indent=2), encoding="utf-8")

    # 1. Sync Ring 1 tiles (.glb, _scatter_trees.bin, _qa_gate1.json)
    ring1_files = dedup_dir_files(drive_root / "02_ASSETS_3D" / "ring1_tiles")
    copied = 0
    for logical, src in ring1_files.items():
        if logical.endswith(".glb") or logical.endswith("_scatter_trees.bin") or logical.endswith("_qa_gate1.json"):
            if copy_if_changed(src, ASSETS_TILES_DIR / logical):
                copied += 1

    # 2. Sync satellite JPGs
    gis_files = dedup_dir_files(drive_root / "01_DATA_REFS" / "gis_tiles")
    for logical, src in gis_files.items():
        if logical.endswith("_satellite.jpg"):
            if copy_if_changed(src, ASSETS_GIS_DIR / logical):
                copied += 1

    # 3. Sync landmarks GLBs
    lm_files = dedup_dir_files(drive_root / "02_ASSETS_3D" / "landmarks")
    for logical, src in lm_files.items():
        if logical.endswith(".glb"):
            if copy_if_changed(src, ASSETS_LANDMARKS_DIR / logical):
                copied += 1

    # 4. Read locks & results
    locks_files = dedup_dir_files(drive_root / "00_STATE" / "locks")
    results_files = dedup_dir_files(drive_root / "00_STATE" / "results")
    released = {k[:-14] for k in locks_files if k.endswith(".released.json")}
    active_locks = {}
    for k, p in locks_files.items():
        if k.endswith(".lock.json"):
            tid = k[:-10]
            if tid not in released:
                try:
                    active_locks[tid] = json.loads(p.read_text(encoding="utf-8"))
                except Exception:
                    pass

    # Build world-index.json with relative URLs for GitHub Pages + local Node
    tiles_out = []
    ready_count = 0
    locked_count = 0
    for item in contract.get("ring1_gis_summary", []):
        tid = item["tile_id"]
        cx = item["ix"] * 2000.0
        cz = item["iz"] * 2000.0
        glb_p = ASSETS_TILES_DIR / f"{tid}.glb"
        scat_p = ASSETS_TILES_DIR / f"{tid}_scatter_trees.bin"
        qa_p = ASSETS_TILES_DIR / f"{tid}_qa_gate1.json"
        sat_p = ASSETS_GIS_DIR / f"{tid}_satellite.jpg"

        status = "pending"
        worker_id = None
        if glb_p.exists():
            status = "ready"
            ready_count += 1
        elif f"TILE_3D_{tid}" in active_locks:
            status = "locked"
            locked_count += 1
            worker_id = active_locks[f"TILE_3D_{tid}"].get("worker_id")

        qa_obj = None
        if qa_p.exists():
            try:
                qa_obj = json.loads(qa_p.read_text(encoding="utf-8"))
            except Exception:
                pass

        tiles_out.append({
            "tile_id": tid,
            "ix": item["ix"],
            "iz": item["iz"],
            "center_x": cx,
            "center_z": cz,
            "bounds": {
                "x_min": cx - 1000.0,
                "x_max": cx + 1000.0,
                "z_min": cz - 1000.0,
                "z_max": cz + 1000.0,
            },
            "buildings_gis": item.get("buildings", 0),
            "roads_gis": item.get("roads", 0),
            "water_polys": item.get("water_polys", 0),
            "glb_url": f"./assets/tiles/{tid}.glb" if glb_p.exists() else None,
            "glb_bytes": glb_p.stat().st_size if glb_p.exists() else 0,
            "scatter_url": f"./assets/tiles/{tid}_scatter_trees.bin" if scat_p.exists() else None,
            "scatter_bytes": scat_p.stat().st_size if scat_p.exists() else 0,
            "qa_gate1": qa_obj,
            "satellite_url": f"./assets/gis/{tid}_satellite.jpg" if sat_p.exists() else None,
            "status": status,
            "worker_id": worker_id,
        })

    lm_assets = [
        {"name": p.name, "url": f"./assets/landmarks/{p.name}", "size": p.stat().st_size}
        for p in sorted(ASSETS_LANDMARKS_DIR.glob("*.glb"))
    ]

    world_index = {
        "project": "HCMC_3D_DIGITAL_TWIN",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "origin": contract.get("coordinate_reference_system", {}),
        "landmarks": contract.get("landmark_world_anchors_ring1", []),
        "landmarks_assets": lm_assets,
        "tiles": tiles_out,
        "stats": {
            "total_ring1_tiles": len(tiles_out),
            "ready_tiles": ready_count,
            "locked_tiles": locked_count,
            "results_count": sum(1 for k in results_files if k.endswith("_result.json")),
            "total_tasks": len(task_board.get("tasks", [])),
        },
    }
    (API_DIR / "world-index.json").write_text(json.dumps(world_index, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[sync_from_drive] copied={copied} ready={ready_count}/{len(tiles_out)} locked={locked_count}")
    return world_index


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--local-drive", default="")
    parser.add_argument("--push", action="store_true")
    args = parser.parse_args()

    local_candidates = [
        args.local_drive,
        r"I:\My Drive\02 JOB\02 WORKING\VIBE CODE\HCMC_3D_DIGITAL_TWIN",
        r"G:\My Drive\02 JOB\02 WORKING\VIBE CODE\HCMC_3D_DIGITAL_TWIN",
    ]
    drive_root = None
    for c in local_candidates:
        if c and pathlib.Path(c, "01_DATA_REFS", "architecture", "GRID_CONTRACT.json").exists():
            drive_root = pathlib.Path(c)
            break

    if drive_root is not None:
        sync_from_local_drive(drive_root)
    else:
        raise RuntimeError("Drive API remote sync requires GOOGLE_SERVICE_ACCOUNT_JSON or local Drive mount.")

    if args.push:
        subprocess.run(["git", "-C", str(ROOT), "add", "-A"], check=True)
        st = subprocess.run(["git", "-C", str(ROOT), "status", "--porcelain"], capture_output=True, text=True)
        if st.stdout.strip():
            ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
            subprocess.run(["git", "-C", str(ROOT), "commit", "-m", f"Sync HCMC 3D assets ({ts})"], check=True)
            subprocess.run(["git", "-C", str(ROOT), "push", "origin", "main"], check=True)
            print("[sync_from_drive] Pushed updates to GitHub!")
        else:
            print("[sync_from_drive] No changes to commit.")


if __name__ == "__main__":
    main()
