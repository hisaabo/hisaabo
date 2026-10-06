/// Strictly parse a `hisaabo://verify?token=<token>` deep link and return the
/// token. Anything that deviates from that exact shape is rejected.
pub fn parse_verify_token(url: &str) -> Option<String> {
    let rest = url.strip_prefix("hisaabo://")?;
    if rest.contains('#') {
        return None;
    }
    let (location, query) = rest.split_once('?')?;
    if location != "verify" && location != "verify/" {
        return None;
    }
    let mut token: Option<&str> = None;
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=')?;
        if key == "token" {
            if token.is_some() {
                return None;
            }
            token = Some(value);
        }
    }
    let token = token?;
    if is_valid_token(token) {
        Some(token.to_string())
    } else {
        None
    }
}

// Tokens are `<uuid>-<nanoid(32)>`; allow only URL-safe characters so the
// value can never carry markup, quotes or path separators.
fn is_valid_token(token: &str) -> bool {
    (16..=256).contains(&token.len())
        && token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "0a1b2c3d-4e5f-6789-abcd-ef0123456789-Abc_def-GHIjklMNOpqrSTUvwxyz0123";

    #[test]
    fn accepts_valid_link() {
        assert_eq!(
            parse_verify_token(&format!("hisaabo://verify?token={TOKEN}")),
            Some(TOKEN.to_string())
        );
    }

    #[test]
    fn rejects_wrong_scheme_or_path() {
        assert_eq!(parse_verify_token(&format!("https://verify?token={TOKEN}")), None);
        assert_eq!(parse_verify_token(&format!("hisaabo://other?token={TOKEN}")), None);
        assert_eq!(parse_verify_token(&format!("hisaabo://verify/x?token={TOKEN}")), None);
        assert_eq!(parse_verify_token(&format!("hisaabo://evil.com/verify?token={TOKEN}")), None);
    }

    #[test]
    fn rejects_injection_and_bad_tokens() {
        assert_eq!(parse_verify_token("hisaabo://verify?token=';alert(1);//aaaaaaaaaaaa"), None);
        assert_eq!(parse_verify_token("hisaabo://verify?token=short"), None);
        assert_eq!(parse_verify_token("hisaabo://verify?token=%27aaaaaaaaaaaaaaaaaaaa"), None);
        assert_eq!(parse_verify_token(&format!("hisaabo://verify?token={TOKEN}&token={TOKEN}")), None);
        assert_eq!(parse_verify_token(&format!("hisaabo://verify?token={TOKEN}#x")), None);
        assert_eq!(parse_verify_token("hisaabo://verify"), None);
        assert_eq!(parse_verify_token(&format!("hisaabo://verify?token={}", "a".repeat(257))), None);
    }
}
