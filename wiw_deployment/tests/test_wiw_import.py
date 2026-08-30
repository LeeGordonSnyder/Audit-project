from pathlib import Path

from wiw_deployment.wiw_import import load_wiw_export

SAMPLE = Path(__file__).parent.parent / "samples" / "sample_wiw_export.csv"


def test_load_sample_csv():
    shifts = load_wiw_export(SAMPLE)
    assert len(shifts) == 12
    jonathan = next(s for s in shifts if s.name == "Jonathan")
    assert jonathan.role == "FL"
    assert jonathan.start_min == 9 * 60
    assert jonathan.end_min == 14 * 60 + 30


def test_missing_column_raises_clear_error(tmp_path):
    bad = tmp_path / "bad.csv"
    bad.write_text("Name,Position\nAlex,Floor Leader\n")
    try:
        load_wiw_export(bad)
        assert False, "expected WiwImportError"
    except Exception as e:
        assert "start_time" in str(e) or "shift" in str(e)
