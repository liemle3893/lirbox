# The ONLY test target in this repo. A plan that names `make test-all` is making a claim
# about this file, and the claim is false — the correction is determined by this file.
.PHONY: build test lint

build:
	go build ./...

test:
	go test ./...

lint:
	go vet ./...
