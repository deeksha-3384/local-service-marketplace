import math

EARTH_RADIUS_KM = 6371.0088


def valid_coordinates(lat, lng):
    return (
        isinstance(lat, (int, float))
        and isinstance(lng, (int, float))
        and -90 <= lat <= 90
        and -180 <= lng <= 180
    )


def haversine_km(lat1, lng1, lat2, lng2):
    """Great-circle distance between two points, in kilometres."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lng2 - lng1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))