#!/usr/bin/env python3
"""Run one minimal-agent turn through the bundled Python SDK runtime."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from stitch_harness import Stitch


def main() -> None:
    """Parse one task and print the agent's final response."""
    parser = argparse.ArgumentParser()
    configured_home = os.environ.get("STITCH_HOME", "")
    parser.add_argument("prompt", help="Task for the minimal agent")
    parser.add_argument("--workspace", type=Path, default=Path.cwd())
    parser.add_argument(
        "--stitch-home",
        type=Path,
        default=Path(configured_home) if configured_home.strip() else None,
    )
    parser.add_argument("--profile", default="sdk-minimal")
    parser.add_argument("--session-id")
    parser.add_argument("--provider", default=os.environ.get("STITCH_PROVIDER") or None)
    parser.add_argument("--model", default=os.environ.get("STITCH_MODEL") or None)
    parser.add_argument("--max-tokens", type=int)
    args = parser.parse_args()
    if args.stitch_home is None:
        parser.error("--stitch-home or a non-empty STITCH_HOME is required")

    workspace = args.workspace.resolve()
    stitch_home = args.stitch_home.resolve()
    with Stitch(
        provider=args.provider,
        model=args.model,
        max_tokens=args.max_tokens,
        cwd=str(workspace),
        stitch_home=str(stitch_home),
        profile=args.profile,
    ) as harness:
        result = harness.run(args.prompt, session_id=args.session_id)
    if result.finish_reason not in (None, "completed"):
        raise RuntimeError(f"Input ended with {result.finish_reason}: {result.final_response}")
    print(result.final_response)


if __name__ == "__main__":
    main()
