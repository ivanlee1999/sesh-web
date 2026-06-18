#!/usr/bin/env python3
from __future__ import annotations

import argparse
import fcntl
import json
import os
import shutil
import sqlite3
import sys
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Iterable

DEFAULT_SOURCE = Path('/home/ivan/docker/sesh-web/data/sesh.db')
DEFAULT_DEST_DIR = Path('/mnt/nas/docker/sesh-web/backups')
DEFAULT_LATEST_NAME = 'sesh-latest.db'


@dataclass
class SnapshotPlan:
    bucket: str
    keep: int
    directory: Path
    name: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            'Create a consistent read-only SQLite backup of the sesh database, '
            'publish it atomically on NAS, and optionally retain hourly/daily/weekly snapshots.'
        )
    )
    parser.add_argument('--source', type=Path, default=DEFAULT_SOURCE, help='Source SQLite DB path')
    parser.add_argument('--dest-dir', type=Path, default=DEFAULT_DEST_DIR, help='Backup destination directory on NAS')
    parser.add_argument('--latest-name', default=DEFAULT_LATEST_NAME, help='Filename for the latest backup artifact')
    parser.add_argument('--keep-hourly', type=int, default=24, help='Hourly snapshots to keep (0 disables)')
    parser.add_argument('--keep-daily', type=int, default=30, help='Daily snapshots to keep (0 disables)')
    parser.add_argument('--keep-weekly', type=int, default=8, help='Weekly snapshots to keep (0 disables)')
    parser.add_argument('--verbose', action='store_true', help='Print a JSON summary on success')
    return parser.parse_args()


@contextmanager
def file_lock(lock_path: Path):
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with open(lock_path, 'w', encoding='utf-8') as fh:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(fh.fileno(), fcntl.LOCK_UN)


def ensure_parent(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def period_start(now: datetime, bucket: str) -> datetime:
    if bucket == 'hourly':
        return now.replace(minute=0, second=0, microsecond=0)
    if bucket == 'daily':
        return now.replace(hour=0, minute=0, second=0, microsecond=0)
    if bucket == 'weekly':
        monday = now - timedelta(days=now.weekday())
        return monday.replace(hour=0, minute=0, second=0, microsecond=0)
    raise ValueError(f'unsupported bucket: {bucket}')


def snapshot_name(bucket: str, start: datetime) -> str:
    if bucket == 'hourly':
        key = start.strftime('%Y%m%dT%H00Z')
    elif bucket == 'daily':
        key = start.strftime('%Y%m%d')
    elif bucket == 'weekly':
        key = start.strftime('%Y%m%d')
    else:
        raise ValueError(f'unsupported bucket: {bucket}')
    return f'sesh-{bucket}-{key}.db'


def build_snapshot_plans(dest_dir: Path, now: datetime, keep_hourly: int, keep_daily: int, keep_weekly: int) -> list[SnapshotPlan]:
    configs = [
        ('hourly', keep_hourly),
        ('daily', keep_daily),
        ('weekly', keep_weekly),
    ]
    plans: list[SnapshotPlan] = []
    for bucket, keep in configs:
        if keep <= 0:
            continue
        directory = dest_dir / bucket
        name = snapshot_name(bucket, period_start(now, bucket))
        plans.append(SnapshotPlan(bucket=bucket, keep=keep, directory=directory, name=name))
    return plans


def fsync_path(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def backup_sqlite(source: Path, temp_backup: Path) -> dict:
    source_uri = f'file:{source}?mode=ro'
    with sqlite3.connect(source_uri, uri=True, timeout=30) as src_conn:
        src_conn.execute('PRAGMA query_only = ON')
        with sqlite3.connect(temp_backup) as dst_conn:
            src_conn.backup(dst_conn)
            dst_conn.execute('PRAGMA journal_mode=DELETE')
            dst_conn.commit()

    cleanup_sidecars(temp_backup)
    stats = temp_backup.stat()
    return {
        'source': str(source),
        'temp_backup': str(temp_backup),
        'size_bytes': stats.st_size,
    }


def publish_latest(temp_backup: Path, latest_path: Path) -> None:
    os.replace(temp_backup, latest_path)
    fsync_path(latest_path)
    fsync_path(latest_path.parent)


def hardlink_or_copy(source: Path, target: Path) -> str:
    if target.exists():
        return 'exists'
    try:
        os.link(source, target)
        return 'linked'
    except OSError:
        shutil.copy2(source, target)
        return 'copied'


def cleanup_sidecars(base_path: Path) -> None:
    for suffix in ('-wal', '-shm'):
        base_path.with_name(base_path.name + suffix).unlink(missing_ok=True)


def prune_old_snapshots(directory: Path, keep: int) -> list[str]:
    if keep <= 0 or not directory.exists():
        return []
    snapshots = sorted([p for p in directory.glob('sesh-*.db') if p.is_file()], key=lambda p: p.name, reverse=True)
    removed: list[str] = []
    for stale in snapshots[keep:]:
        stale.unlink(missing_ok=True)
        removed.append(str(stale))
    return removed


def verify_backup_file(path: Path) -> dict:
    uri = f'file:{path}?mode=ro&immutable=1'
    with sqlite3.connect(uri, uri=True, timeout=30) as conn:
        cur = conn.cursor()
        cur.execute('PRAGMA integrity_check')
        integrity = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'")
        table_count = cur.fetchone()[0]
        session_count = None
        try:
            cur.execute('SELECT COUNT(*) FROM sessions')
            session_count = cur.fetchone()[0]
        except sqlite3.Error:
            session_count = None
    return {
        'integrity_check': integrity,
        'table_count': table_count,
        'sessions_count': session_count,
    }


def main() -> int:
    args = parse_args()
    source = args.source.resolve()
    dest_dir = args.dest_dir.resolve()
    latest_path = dest_dir / args.latest_name
    lock_path = dest_dir / '.backup.lock'
    now = datetime.now(UTC)

    if not source.exists():
        print(f'Source DB does not exist: {source}', file=sys.stderr)
        return 1

    ensure_parent(dest_dir)
    snapshot_plans = build_snapshot_plans(dest_dir, now, args.keep_hourly, args.keep_daily, args.keep_weekly)
    for plan in snapshot_plans:
        ensure_parent(plan.directory)

    with file_lock(lock_path):
        fd, temp_name = tempfile.mkstemp(prefix='.sesh-backup-', suffix='.tmp', dir=dest_dir)
        os.close(fd)
        temp_backup = Path(temp_name)
        try:
            backup_meta = backup_sqlite(source, temp_backup)
            verify_meta = verify_backup_file(temp_backup)
            if verify_meta['integrity_check'] != 'ok':
                raise RuntimeError(f"integrity_check failed: {verify_meta['integrity_check']}")

            publish_latest(temp_backup, latest_path)
            cleanup_sidecars(latest_path)

            published_snapshots: list[dict] = []
            pruned: list[str] = []
            for plan in snapshot_plans:
                snapshot_path = plan.directory / plan.name
                action = hardlink_or_copy(latest_path, snapshot_path)
                cleanup_sidecars(snapshot_path)
                published_snapshots.append({
                    'bucket': plan.bucket,
                    'path': str(snapshot_path),
                    'action': action,
                })
                pruned.extend(prune_old_snapshots(plan.directory, plan.keep))

            if args.verbose:
                print(json.dumps({
                    'latest': str(latest_path),
                    'backup': backup_meta,
                    'verification': verify_meta,
                    'snapshots': published_snapshots,
                    'pruned': pruned,
                    'created_at_utc': now.isoformat().replace('+00:00', 'Z'),
                }, indent=2))
        except Exception as exc:
            temp_backup.unlink(missing_ok=True)
            print(f'Backup failed: {exc}', file=sys.stderr)
            return 1

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
