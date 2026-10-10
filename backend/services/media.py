"""Identifies uploads by their first bytes. The client's filename and
Content-Type are never trusted."""


def sniff_audio(data):
    head = data[:12]
    if head[:4] == b"\x1a\x45\xdf\xa3":
        return "webm", "audio/webm"
    if head[:4] == b"OggS":
        return "ogg", "audio/ogg"
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "wav", "audio/wav"
    if head[4:8] == b"ftyp":
        return "m4a", "audio/mp4"
    if head[:3] == b"ID3" or (len(head) >= 2 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0):
        return "mp3", "audio/mpeg"
    return None


def sniff_image(data):
    head = data[:12]
    if head[:3] == b"\xff\xd8\xff":
        return "jpg", "image/jpeg"
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return "png", "image/png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp", "image/webp"
    return None