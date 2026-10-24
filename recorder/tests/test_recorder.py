import datetime as dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import recorder  # noqa: E402


def test_parse_topic_ding_on():
    assert recorder.parse_topic("ring/loc1/camera/abc123/ding/state", "ON") == ("abc123", "ding")


def test_parse_topic_motion_on():
    assert recorder.parse_topic("ring/loc1/camera/abc123/motion/state", "on\n") == ("abc123", "motion")


def test_parse_topic_ignores_off_and_other_topics():
    assert recorder.parse_topic("ring/loc1/camera/abc123/ding/state", "OFF") is None
    assert recorder.parse_topic("ring/loc1/camera/abc123/light/state", "ON") is None
    assert recorder.parse_topic("ring/loc1/camera/abc123/ding/attributes", "ON") is None
    assert recorder.parse_topic("ring/loc1/alarm/abc123/ding/state", "ON") is None


def test_rtsp_url_includes_credentials(monkeypatch):
    monkeypatch.setattr(recorder, "RTSP_USER", "u")
    monkeypatch.setattr(recorder, "RTSP_PASS", "p")
    assert recorder.rtsp_url("abc") == "rtsp://u:p@localhost:8554/abc_live"


def make_clip(root, day, name):
    d = root / day
    d.mkdir(exist_ok=True)
    clip = d / name
    clip.write_bytes(b"x")
    clip.with_suffix(".jpg").write_bytes(b"x")
    return clip


def test_prune_removes_old_days(tmp_path):
    old = make_clip(tmp_path, "2026-01-01", "120000_ding_abc.mp4")
    new = make_clip(tmp_path, "2026-01-30", "120000_motion_abc.mp4")
    (tmp_path / "index.html").write_text("")
    recorder.prune(tmp_path, keep_days=10, min_free_gb=0, now=dt.datetime(2026, 2, 1))
    assert not old.parent.exists()
    assert new.exists()


def test_prune_frees_space_oldest_first(tmp_path, monkeypatch):
    a = make_clip(tmp_path, "2026-01-30", "080000_ding_abc.mp4")
    b = make_clip(tmp_path, "2026-01-31", "090000_ding_abc.mp4")
    frees = iter([0, 10 * 1024**3])

    class Usage:
        def __init__(self):
            self.free = next(frees)

    monkeypatch.setattr(recorder.shutil, "disk_usage", lambda _: Usage())
    recorder.prune(tmp_path, keep_days=365, min_free_gb=5, now=dt.datetime(2026, 2, 1))
    assert not a.exists() and not a.with_suffix(".jpg").exists()
    assert not a.parent.exists()
    assert b.exists()


def test_write_index_lists_newest_first(tmp_path):
    make_clip(tmp_path, "2026-01-30", "080000_ding_abc.mp4")
    make_clip(tmp_path, "2026-01-31", "093015_motion_abc.mp4")
    recorder.write_index(tmp_path)
    page = (tmp_path / "index.html").read_text()
    assert page.index("2026-01-31") < page.index("2026-01-30")
    assert "09:30:15" in page and 'poster="2026-01-31/093015_motion_abc.jpg"' in page


def test_motion_notifications_have_cooldown(monkeypatch):
    monkeypatch.setattr(recorder, "MOTION_COOLDOWN", 120)
    r = recorder.Recorder()
    assert r._should_notify("abc", "motion")
    assert not r._should_notify("abc", "motion")
    assert r._should_notify("abc", "ding")
