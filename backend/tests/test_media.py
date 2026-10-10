import time

import pytest

from errors import ApiError
from rate_limit import check_rate
from services import media


def test_sniff_audio_formats():
    assert media.sniff_audio(b"\x1a\x45\xdf\xa3" + b"0" * 20) == ("webm", "audio/webm")
    assert media.sniff_audio(b"OggS" + b"0" * 20) == ("ogg", "audio/ogg")
    assert media.sniff_audio(b"RIFF\x00\x00\x00\x00WAVEfmt ") == ("wav", "audio/wav")
    assert media.sniff_audio(b"\x00\x00\x00\x20ftypM4A " + b"0" * 8) == ("m4a", "audio/mp4")
    assert media.sniff_audio(b"ID3\x03\x00" + b"0" * 10) == ("mp3", "audio/mpeg")
    assert media.sniff_audio(b"\xff\xfb\x90\x00" + b"0" * 10) == ("mp3", "audio/mpeg")


@pytest.mark.parametrize("data", [b"", b"MZ\x90\x00\x03", b"just text, not audio", b"GIF89a"])
def test_sniff_audio_rejects_other_files(data):
    assert media.sniff_audio(data) is None


def test_sniff_image_formats():
    assert media.sniff_image(b"\xff\xd8\xff\xe0" + b"0" * 10) == ("jpg", "image/jpeg")
    assert media.sniff_image(b"\x89PNG\r\n\x1a\n" + b"0" * 10) == ("png", "image/png")
    assert media.sniff_image(b"RIFF\x00\x00\x00\x00WEBPVP8 ") == ("webp", "image/webp")


@pytest.mark.parametrize("data", [b"", b"GIF89a....", b"<svg></svg>", b"RIFF\x00\x00\x00\x00WAVEfmt "])
def test_sniff_image_rejects_other_files(data):
    assert media.sniff_image(data) is None


def test_rate_limiter_blocks_after_limit():
    key = f"test:{time.time()}"
    for _ in range(3):
        check_rate(key, 3, 60)
    with pytest.raises(ApiError) as exc:
        check_rate(key, 3, 60)
    assert exc.value.status == 429
    assert exc.value.code == "RATE_LIMITED"
    assert exc.value.details["retry_after_seconds"] >= 1


def test_rate_limiter_is_per_key():
    stamp = time.time()
    check_rate(f"a:{stamp}", 1, 60)
    check_rate(f"b:{stamp}", 1, 60)