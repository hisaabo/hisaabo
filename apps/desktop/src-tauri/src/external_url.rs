//! Allowlist for URLs the webview may ask the shell to open externally.

/// Only plain `https://` URLs are allowed (plus loopback `http://` in debug
/// builds, for local development). Anything containing whitespace, control
/// characters, shell/markup metacharacters or userinfo is rejected.
pub fn is_allowed_external_url(url: &str, allow_local_http: bool) -> bool {
    if url.is_empty() || url.len() > 2048 {
        return false;
    }
    if url
        .bytes()
        .any(|b| b <= b' ' || b == 0x7f || matches!(b, b'"' | b'<' | b'>' | b'\\' | b'^' | b'`' | b'|' | b'{' | b'}'))
    {
        return false;
    }
    if let Some(rest) = url.strip_prefix("https://") {
        return authority_ok(rest);
    }
    if allow_local_http {
        if let Some(rest) = url.strip_prefix("http://") {
            if !authority_ok(rest) {
                return false;
            }
            let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
            let host = authority.split(':').next().unwrap_or("");
            return host == "localhost" || host == "127.0.0.1";
        }
    }
    false
}

fn authority_ok(rest: &str) -> bool {
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    !authority.is_empty()
        && !authority.starts_with(':')
        && !authority.contains('@')
        && !authority.contains('%')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_https() {
        assert!(is_allowed_external_url("https://app.hisaabo.in/auth/native?request=abc-123", false));
        assert!(is_allowed_external_url("https://app.hisaabo.in", false));
        assert!(is_allowed_external_url("https://example.com:8443/a?b=c&d=e#f", false));
    }

    #[test]
    fn rejects_other_schemes() {
        for url in [
            "http://app.hisaabo.in/",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "hisaabo://verify?token=x",
            "ms-msdt:/id PCWDiagnostic",
            "smb://host/share",
            "ftp://example.com",
            "HTTPS://example.com",
            "",
            "example.com",
        ] {
            assert!(!is_allowed_external_url(url, false), "{url}");
        }
    }

    #[test]
    fn rejects_malformed_https() {
        for url in [
            "https://",
            "https:///path",
            "https://user@evil.com/",
            "https://good.com@evil.com/",
            "https://exa mple.com/",
            "https://example.com/\" & calc",
            "https://example.com/a|b",
            "https://example.com/\n",
            "https://example.com/<x>",
            "https://example.com\\evil",
            "https://ex%41mple.com/",
        ] {
            assert!(!is_allowed_external_url(url, false), "{url}");
        }
        let long = format!("https://example.com/{}", "a".repeat(2100));
        assert!(!is_allowed_external_url(&long, false));
    }

    #[test]
    fn local_http_only_when_enabled() {
        assert!(!is_allowed_external_url("http://localhost:5173/auth/native?request=a", false));
        assert!(is_allowed_external_url("http://localhost:5173/auth/native?request=a", true));
        assert!(is_allowed_external_url("http://127.0.0.1:3000/x", true));
        assert!(!is_allowed_external_url("http://localhost.evil.com/", true));
        assert!(!is_allowed_external_url("http://evil.com/", true));
    }
}
