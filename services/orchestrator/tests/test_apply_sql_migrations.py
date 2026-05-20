"""SQL migration 脚本：schema_migrations 表与跳过已应用文件。"""

from pathlib import Path


def test_migration_filenames_are_unique_prefix_groups():
    init_dir = Path(__file__).resolve().parents[3] / "infra" / "postgres" / "init"
    names = sorted(p.name for p in init_dir.glob("*.sql"))
    assert names
    # 旧式重复编号 027_foo.sql + 027_bar.sql 不应再出现（已改为 02701_/02702_）
    stems = [n.split("_", 1)[0] for n in names if "_" in n]
    dup_three_digit = [s for s in stems if len(s) == 3 and s.isdigit()]
    assert len(dup_three_digit) == len(set(dup_three_digit)), f"duplicate 3-digit prefixes: {names}"
