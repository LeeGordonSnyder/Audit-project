"""
Command-line entry point.

    python -m wiw_deployment build --wiw export.csv --template deployment.xlsx \
        --date 2026-08-30 --output 2026-08-30-deployment.xlsx

    python -m wiw_deployment demo-template --output demo_template.xlsx
"""
from __future__ import annotations

import argparse
import sys
from datetime import date, datetime
from pathlib import Path

from . import workbook
from .breaks import BreakScheduler
from .wiw_import import load_wiw_export


def _cmd_build(args: argparse.Namespace) -> int:
    target_date = datetime.strptime(args.date, "%Y-%m-%d").date() if args.date else None

    shifts = load_wiw_export(args.wiw, target_date=target_date)
    if not shifts:
        print("No shifts found in the WiW export for that date.", file=sys.stderr)
        return 1

    BreakScheduler(shifts).schedule_all()

    warnings = workbook.fill_workbook(
        template_path=args.template,
        output_path=args.output,
        shifts=shifts,
        sheet_name=args.sheet,
        target_date=target_date,
        date_cell=args.date_cell,
    )

    print(f"Wrote {len(shifts)} shifts to {args.output}")
    for w in warnings:
        print(f"WARNING: {w}", file=sys.stderr)
    return 0


def _cmd_demo_template(args: argparse.Namespace) -> int:
    workbook.build_demo_template(args.output)
    print(f"Wrote demo template to {args.output}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="wiw_deployment")
    sub = parser.add_subparsers(dest="command", required=True)

    p_build = sub.add_parser("build", help="Build a deployment workbook from a WiW export")
    p_build.add_argument("--wiw", required=True, help="Path to the WiW schedule export (.csv or .xlsx)")
    p_build.add_argument("--template", required=True, help="Path to the deployment workbook template to fill")
    p_build.add_argument("--output", required=True, help="Path to write the filled workbook to")
    p_build.add_argument("--date", help="Target date (YYYY-MM-DD); filters multi-day exports and stamps the date cell")
    p_build.add_argument("--sheet", help="Sheet name in the template to fill (default: active sheet)")
    p_build.add_argument("--date-cell", help="Cell address to stamp with the date, e.g. B1 (optional)")
    p_build.set_defaults(func=_cmd_build)

    p_demo = sub.add_parser("demo-template", help="Generate a demo template workbook to try the tool with")
    p_demo.add_argument("--output", required=True)
    p_demo.set_defaults(func=_cmd_demo_template)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
