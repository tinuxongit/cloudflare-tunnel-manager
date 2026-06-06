//! Embeds Windows resource metadata into the connector .exe — file
//! description, company, version, copyright. Doesn't make SmartScreen
//! shut up entirely (only code-signing does that), but at least the
//! Properties → Details tab is filled in and AV heuristics that rely on
//! "no metadata = suspicious" stop firing.

fn main() {
    #[cfg(target_os = "windows")]
    {
        let mut res = winresource::WindowsResource::new();
        res.set("FileDescription", "Cloudflare Tunnel Manager — connector");
        res.set("ProductName", "Cloudflare Tunnel Manager Connector");
        res.set("CompanyName", "Cloudflare Tunnel Manager");
        res.set("LegalCopyright", "MIT licensed — see repository");
        res.set("OriginalFilename", "cf-tunnel-connector.exe");
        res.set("InternalName", "cf-tunnel-connector");
        if let Err(e) = res.compile() {
            // Don't fail the build on resource embedding — it's nice-to-have.
            eprintln!("cargo:warning=winresource compile failed: {e}");
        }
    }
}
