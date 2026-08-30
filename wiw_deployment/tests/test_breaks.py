from wiw_deployment import config
from wiw_deployment.breaks import BreakScheduler, Shift, required_breaks


def test_required_breaks_tiers():
    assert required_breaks(4.0) == []
    assert required_breaks(5.0) == []          # exactly 5h: no break
    assert required_breaks(5.5) == [15]        # over 5h, under 6h
    assert required_breaks(6.0) == [15, 30]    # 6h-8.5h
    assert required_breaks(7.5) == [15, 30]
    assert required_breaks(8.5) == [15, 30, 15]  # 8.5h+
    assert required_breaks(9.0) == [15, 30, 15]


def _on_floor_at(shifts, minute):
    on_break = set()
    for s in shifts:
        for b in s.breaks:
            if b.start_min <= minute < b.start_min + b.duration_min:
                on_break.add(s.name)
    return [s for s in shifts if s.start_min <= minute < s.end_min and s.name not in on_break]


def _assert_coverage_never_breached(shifts):
    all_minutes = sorted({m for s in shifts for m in range(s.start_min, s.end_min)})
    for m in all_minutes:
        scheduled = [s for s in shifts if s.start_min <= m < s.end_min]
        on_floor = _on_floor_at(shifts, m)
        assert len(on_floor) >= min(config.MIN_STAFF_ON_FLOOR, len(scheduled)), (
            f"floor too thin at minute {m}: {[s.name for s in on_floor]}"
        )
        fl_scheduled = [s for s in scheduled if s.is_floor_lead]
        if fl_scheduled:
            fl_on_floor = [s for s in on_floor if s.is_floor_lead]
            assert len(fl_on_floor) >= min(config.MIN_FLOOR_LEADS_ON_FLOOR, len(fl_scheduled)), (
                f"no floor lead on floor at minute {m}"
            )


def test_scheduler_respects_min_coverage_typical_day():
    shifts = [
        Shift("Jonathan", "FL", 9 * 60, 14 * 60 + 30),
        Shift("Li", "PG", 9 * 60, 14 * 60),
        Shift("Sammy", "PG", 9 * 60, 14 * 60),
        Shift("Jacob", "PG", 9 * 60 + 30, 16 * 60),
        Shift("Liv", "FL", 11 * 60 + 30, 19 * 60),
        Shift("Steven", "FL", 14 * 60, 21 * 60 + 45),
        Shift("Antoine", "PG", 15 * 60, 22 * 60),
        Shift("August", "PG", 16 * 60 + 45, 21 * 60 + 45),
    ]
    BreakScheduler(shifts).schedule_all()
    _assert_coverage_never_breached(shifts)

    for s in shifts:
        expected = required_breaks(s.duration_hours)
        assert [b.duration_min for b in s.breaks] == expected


def test_impossible_coverage_is_flagged_not_silently_violated():
    # With only two people scheduled for the whole day, MIN_STAFF_ON_FLOOR=2
    # makes any break mathematically impossible to place cleanly. The
    # scheduler must not pretend otherwise -- it should flag these breaks
    # for human review rather than silently leaving the floor short-staffed.
    shifts = [
        Shift("SoloLead", "FL", 9 * 60, 17 * 60),
        Shift("Helper", "PG", 9 * 60, 17 * 60),
    ]
    BreakScheduler(shifts).schedule_all()
    assert any(b.flagged for s in shifts for b in s.breaks)


def test_breaks_are_spread_out_not_clustered():
    shifts = [
        Shift("LongDay", "PG", 9 * 60, 18 * 60),
        Shift("Other", "FL", 9 * 60, 18 * 60),
        Shift("Extra", "PG", 9 * 60, 18 * 60),
    ]
    BreakScheduler(shifts).schedule_all()
    long_day = shifts[0]
    assert len(long_day.breaks) == 3  # 9h shift (>=8.5h) -> 15+30+15
    starts = sorted(b.start_min for b in long_day.breaks)
    assert starts[1] - starts[0] > 60  # not back-to-back
    assert starts[2] - starts[1] > 60


def test_multiple_floor_leads_not_all_on_break_together():
    shifts = [
        Shift("FL1", "FL", 9 * 60, 18 * 60),
        Shift("FL2", "FL", 9 * 60, 18 * 60),
        Shift("PG1", "PG", 9 * 60, 18 * 60),
        Shift("PG2", "PG", 9 * 60, 18 * 60),
    ]
    BreakScheduler(shifts).schedule_all()
    _assert_coverage_never_breached(shifts)
    fl1, fl2 = shifts[0], shifts[1]
    for b1 in fl1.breaks:
        for b2 in fl2.breaks:
            overlap = b1.start_min < b2.start_min + b2.duration_min and b2.start_min < b1.start_min + b1.duration_min
            assert not overlap, "both floor leads on break at the same time"
