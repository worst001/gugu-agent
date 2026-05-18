fn main() {
    println!("cargo:rerun-if-env-changed=GUGU_DESKTOP_DEFAULT_GATEWAY_URL");
    tauri_build::build()
}
