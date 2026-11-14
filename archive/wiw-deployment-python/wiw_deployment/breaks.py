"""
Break-rule and break-placement logic.

Two separate concerns live here:

1. ``required_breaks`` - pure lookup from shift length -> which breaks
   (durations in minutes) that shift is owed.
2. ``BreakScheduler`` - places those breaks on the clock for every shift in
   a day, spacing each person's own breaks evenly through their shift while
   never letting store floor coverage drop below the configured minimums.

The placement problem is a constraint search, not a formula, so it's solved
with a greedy heuristic: process shifts in the order they're "hardest to
place" (most break-minutes owed first), and for each break, try the ideal
evenly-spaced target time, then walk outward in small steps until a slot is
found that keeps the floor adequately covered. This is not guaranteed to
find a solution if one exists in every pathological case (e.g. a day with
only two people scheduled, both needing breaks) -- when it can't, the break
is placed as best-effort and flagged so a human can adjust it.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from . import config


@dataclass
class Shift:
    name: str
    role: str
    start_min: int  # minutes since midnight
    end_min: int
    breaks: list["PlacedBreak"] = field(default_factory=list)

    @property
    def duration_hours(self) -> float:
        return (self.end_min - self.start_min) / 60.0

    @property
    def is_floor_lead(self) -> bool:
        return self.role == "FL"


@dataclass
class PlacedBreak:
    start_min: int
    duration_min: int
    flagged: bool = False  # True if no fully-valid slot could be found

    @property
    def end_min(self) -> int:
        return self.start_min + self.duration_min


def required_breaks(duration_hours: float) -> list[int]:
    """Break durations (minutes) owed for a shift of this length, in the
    order they should fall across the shift (30 sandwiched between the two
    15s when a shift earns three breaks)."""
    if duration_hours <= config.NO_BREAK_MAX_HOURS:
        return []
    if duration_hours < config.ONE_FIFTEEN_MAX_HOURS:
        return [15]
    if duration_hours < config.FIFTEEN_AND_THIRTY_MAX_HOURS:
        return [15, 30]
    return [15, 30, 15]


def _ideal_targets(workable_start: int, workable_end: int, durations: list[int]) -> list[int]:
    """Evenly-spaced ideal start minutes for each break duration, centered on
    the (n+1)-way split points of the workable window."""
    n = len(durations)
    span = workable_end - workable_start
    targets = []
    for i, dur in enumerate(durations, start=1):
        center = workable_start + span * i / (n + 1)
        start = round(center - dur / 2)
        start = max(workable_start, min(start, workable_end - dur))
        targets.append(start)
    return targets


class BreakScheduler:
    """Places breaks for a full day's shifts, tracking floor coverage as it
    goes so later placements respect earlier ones."""

    def __init__(self, shifts: list[Shift]):
        self.shifts = shifts
        # minute -> set of names currently on break, built up as we place breaks
        self._on_break: dict[int, set[str]] = {}

    def schedule_all(self) -> list[Shift]:
        order = sorted(
            self.shifts,
            key=lambda s: (-sum(required_breaks(s.duration_hours)), s.start_min),
        )
        for shift in order:
            durations = required_breaks(shift.duration_hours)
            if not durations:
                continue
            workable_start = shift.start_min + config.SHIFT_EDGE_BUFFER_MINUTES
            workable_end = shift.end_min - config.SHIFT_EDGE_BUFFER_MINUTES
            if workable_end <= workable_start:
                # Shift too short for the buffer; fall back to the raw shift bounds.
                workable_start, workable_end = shift.start_min, shift.end_min

            targets = _ideal_targets(workable_start, workable_end, durations)
            placed: list[PlacedBreak] = []
            for target, dur in zip(targets, durations):
                start, ok = self._find_valid_slot(
                    shift, target, dur, workable_start, workable_end, placed
                )
                placed.append(PlacedBreak(start_min=start, duration_min=dur, flagged=not ok))
            shift.breaks = sorted(placed, key=lambda b: b.start_min)
            for b in shift.breaks:
                self._reserve(shift.name, b.start_min, b.duration_min)
        return self.shifts

    def _reserve(self, name: str, start_min: int, duration_min: int) -> None:
        for m in range(start_min, start_min + duration_min, config.TIME_STEP_MINUTES):
            self._on_break.setdefault(m, set()).add(name)

    def _min_gap_ok(self, placed: list[PlacedBreak], candidate_start: int, candidate_end: int) -> bool:
        """Keep a person's own breaks from landing back-to-back."""
        min_gap = config.TIME_STEP_MINUTES * 2
        for b in placed:
            if candidate_start < b.end_min + min_gap and b.start_min < candidate_end + min_gap:
                return False
        return True

    def _is_valid(self, shift: Shift, start_min: int, duration_min: int, placed: list[PlacedBreak]) -> bool:
        end_min = start_min + duration_min
        if start_min < shift.start_min or end_min > shift.end_min:
            return False
        if not self._min_gap_ok(placed, start_min, end_min):
            return False

        for m in range(start_min, end_min, config.TIME_STEP_MINUTES):
            on_break_now = set(self._on_break.get(m, set()))
            on_break_now.add(shift.name)

            scheduled_now = [s for s in self.shifts if s.start_min <= m < s.end_min]
            on_floor_now = [s for s in scheduled_now if s.name not in on_break_now]

            if len(on_floor_now) < config.MIN_STAFF_ON_FLOOR:
                return False

            fl_scheduled = [s for s in scheduled_now if s.is_floor_lead]
            if fl_scheduled:
                fl_on_floor = [s for s in on_floor_now if s.is_floor_lead]
                if len(fl_on_floor) < min(config.MIN_FLOOR_LEADS_ON_FLOOR, len(fl_scheduled)):
                    return False
        return True

    def _find_valid_slot(
        self,
        shift: Shift,
        target: int,
        duration_min: int,
        workable_start: int,
        workable_end: int,
        placed: list[PlacedBreak],
    ) -> tuple[int, bool]:
        if self._is_valid(shift, target, duration_min, placed):
            return target, True

        max_radius = max(workable_end - workable_start, shift.end_min - shift.start_min)
        step = config.TIME_STEP_MINUTES
        radius = step
        while radius <= max_radius:
            for candidate in (target + radius, target - radius):
                clamped = max(workable_start, min(candidate, workable_end - duration_min))
                if clamped != candidate:
                    continue  # only accept in-window candidates here
                if self._is_valid(shift, clamped, duration_min, placed):
                    return clamped, True
            radius += step

        # Best-effort fallback: clamp to the window and flag for human review.
        fallback = max(workable_start, min(target, workable_end - duration_min))
        return fallback, False
