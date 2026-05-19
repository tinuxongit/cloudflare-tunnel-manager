use std::path::PathBuf;

pub fn cert_path() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
        .join(".cloudflared").join("cert.pem")
}

pub fn is_logged_in() -> bool {
    cert_path().exists()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cert_path_ends_with_cloudflared_cert_pem() {
        let p = cert_path();
        assert!(p.ends_with(".cloudflared/cert.pem") || p.ends_with(r".cloudflared\cert.pem"));
    }
}
