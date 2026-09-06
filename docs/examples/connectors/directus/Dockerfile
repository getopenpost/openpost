FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod main.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /connector .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /connector /connector
ENTRYPOINT ["/connector"]
