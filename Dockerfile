# Stage 1: Build
FROM rust:1.93-bookworm AS builder

WORKDIR /build

# Copy workspace manifests and lock file
COPY Cargo.toml Cargo.lock ./
COPY crates/shared/Cargo.toml crates/shared/Cargo.toml
COPY crates/server/Cargo.toml crates/server/Cargo.toml

# Create dummy src-tauri manifest so workspace resolves
# (src-tauri is a workspace member but we don't build it)
RUN mkdir -p src-tauri/src && \
    echo '[package]\nname = "flux-tauri"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]' > src-tauri/Cargo.toml && \
    echo 'fn main() {}' > src-tauri/src/main.rs

# Create dummy sources for dependency caching
RUN mkdir -p crates/shared/src crates/server/src && \
    echo '' > crates/shared/src/lib.rs && \
    echo 'fn main() {}' > crates/server/src/main.rs

# Build dependencies only (cached layer)
RUN cargo build --release -p flux-server 2>/dev/null || true

# Copy real source code
COPY crates/shared/ crates/shared/
COPY crates/server/ crates/server/

# Touch source files to invalidate cache
RUN touch crates/shared/src/lib.rs crates/server/src/main.rs

# Build the real binary
RUN cargo build --release -p flux-server

# Stage 2: Runtime
FROM debian:bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /build/target/release/flux-server .

EXPOSE 3001

CMD ["./flux-server"]
