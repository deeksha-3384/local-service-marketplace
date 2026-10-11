import pytest
from flask import Flask

from errors import ApiError
from pagination import paginated, parse_pagination, parse_sort
from services.geo import haversine_km, valid_coordinates
from validation import Schema, parse_body

flask_app = Flask(__name__)


class Demo(Schema):
    title: str
    price: float


# ---- pagination ----

def test_pagination_defaults():
    with flask_app.test_request_context("/"):
        assert parse_pagination() == (1, 20, 0)


def test_pagination_values():
    with flask_app.test_request_context("/?page=3&limit=10"):
        assert parse_pagination() == (3, 10, 20)


@pytest.mark.parametrize("qs", ["page=0", "page=abc", "limit=0", "limit=101", "limit=-5"])
def test_pagination_rejects_bad_values(qs):
    with flask_app.test_request_context("/?" + qs):
        with pytest.raises(ApiError) as exc:
            parse_pagination()
        assert exc.value.status == 422
        assert exc.value.code == "VALIDATION_ERROR"


def test_paginated_shape():
    assert paginated([1], 2, 10, 11) == {"items": [1], "page": 2, "limit": 10, "total": 11}


# ---- sorting ----

ALLOWED = {"created_at", "severity_score"}


def test_sort_default_and_explicit():
    with flask_app.test_request_context("/"):
        assert parse_sort(ALLOWED, "created_at") == ("created_at", "desc")
    with flask_app.test_request_context("/?sort=severity_score&order=ASC"):
        assert parse_sort(ALLOWED, "created_at") == ("severity_score", "asc")


@pytest.mark.parametrize(
    "qs",
    ["sort=password", "sort=created_at;drop table requests", "sort=created_at&order=sideways"],
)
def test_sort_rejects_unsafe_values(qs):
    with flask_app.test_request_context("/?" + qs):
        with pytest.raises(ApiError) as exc:
            parse_sort(ALLOWED, "created_at")
        assert exc.value.status == 422


# ---- body validation ----

def test_parse_body_valid_and_trimmed():
    with flask_app.test_request_context("/", method="POST", json={"title": "  Leak  ", "price": 10}):
        body = parse_body(Demo)
        assert body.title == "Leak"
        assert body.price == 10


def test_parse_body_rejects_unknown_field():
    with flask_app.test_request_context("/", method="POST", json={"title": "x", "price": 1, "oops": 1}):
        with pytest.raises(ApiError) as exc:
            parse_body(Demo)
        assert exc.value.code == "VALIDATION_ERROR"
        assert exc.value.details[0]["field"] == "oops"


def test_parse_body_reports_missing_and_wrong_type():
    with flask_app.test_request_context("/", method="POST", json={"price": "cheap"}):
        with pytest.raises(ApiError) as exc:
            parse_body(Demo)
        fields = {d["field"] for d in exc.value.details}
        assert fields == {"title", "price"}


@pytest.mark.parametrize("payload", [[1, 2], "text", None])
def test_parse_body_rejects_non_object(payload):
    with flask_app.test_request_context("/", method="POST", json=payload):
        with pytest.raises(ApiError) as exc:
            parse_body(Demo)
        assert exc.value.status == 422


# ---- geo ----

def test_haversine_same_point_is_zero():
    assert haversine_km(12.97, 77.59, 12.97, 77.59) == pytest.approx(0, abs=1e-9)


def test_haversine_known_distance_paris_london():
    assert haversine_km(48.8566, 2.3522, 51.5074, -0.1278) == pytest.approx(343.5, abs=2)


def test_haversine_is_symmetric():
    a = haversine_km(12.97, 77.59, 13.08, 80.27)
    b = haversine_km(13.08, 80.27, 12.97, 77.59)
    assert a == pytest.approx(b)


def test_valid_coordinates():
    assert valid_coordinates(12.9, 77.5)
    assert not valid_coordinates(91, 0)
    assert not valid_coordinates(0, 181)
    assert not valid_coordinates("12", 77)