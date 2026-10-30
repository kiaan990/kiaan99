.PHONY: check lint type test fmt
check: lint type test

lint:
	uv run ruff check src tests

type:
	uv run mypy

test:
	uv run pytest -q

fmt:
	uv run ruff check --fix src tests
