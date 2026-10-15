fn main() {
    // ponytail: only --version for now; the stdio protocol comes in phase 4.
    println!("hdlstudio {}", env!("CARGO_PKG_VERSION"));
}
