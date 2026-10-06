//! Loopback receiver for the RFC 8252 browser sign-in handoff.
//!
//! The desktop app binds a one-shot HTTP listener on 127.0.0.1, the system
//! browser is sent to the web app, and after the user consents the web app
//! redirects the browser to `http://127.0.0.1:<port>/callback?code=..&state=..`.
//! This module accepts exactly one well-formed callback and hands the
//! `code`/`state` pair back; everything else is answered with 404 and ignored.

use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant};

pub const CALLBACK_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const MAX_REQUEST_BYTES: usize = 8 * 1024;
const READ_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Callback {
    pub code: String,
    pub state: String,
}

const SUCCESS_PAGE: &str = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">\
<title>Hisaabo</title><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\
<style>body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;\
justify-content:center;margin:0;color:#1f2937}main{text-align:center;padding:24px}</style></head>\
<body><main><h1>Signed in</h1><p>You can return to Hisaabo and close this tab.</p></main></body></html>";

fn is_url_safe(value: &str, min: usize, max: usize) -> bool {
    (min..=max).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Strictly parse an HTTP request line `GET /callback?code=..&state=.. HTTP/1.1`.
/// Only the exact path, method and the two URL-safe parameters are accepted.
pub fn parse_callback_request(request_line: &str) -> Option<Callback> {
    let mut parts = request_line.trim_end_matches(['\r', '\n']).split(' ');
    let method = parts.next()?;
    let target = parts.next()?;
    let version = parts.next()?;
    if parts.next().is_some() || method != "GET" {
        return None;
    }
    if version != "HTTP/1.1" && version != "HTTP/1.0" {
        return None;
    }
    let query = target.strip_prefix("/callback?")?;
    let mut code: Option<&str> = None;
    let mut state: Option<&str> = None;
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=')?;
        let slot = match key {
            "code" => &mut code,
            "state" => &mut state,
            _ => return None,
        };
        if slot.is_some() {
            return None;
        }
        *slot = Some(value);
    }
    let code = code?;
    let state = state?;
    if !is_url_safe(code, 16, 128) || !is_url_safe(state, 16, 128) {
        return None;
    }
    Some(Callback {
        code: code.to_string(),
        state: state.to_string(),
    })
}

fn read_request_line(stream: &mut TcpStream) -> Option<String> {
    stream.set_read_timeout(Some(READ_TIMEOUT)).ok()?;
    let mut buf = Vec::with_capacity(512);
    let mut chunk = [0u8; 512];
    while buf.len() < MAX_REQUEST_BYTES {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                if let Some(end) = buf.windows(2).position(|w| w == b"\r\n") {
                    return String::from_utf8(buf[..end].to_vec()).ok();
                }
            }
            Err(_) => return None,
        }
    }
    None
}

fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\n\
Cache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

/// Accept connections until one carries a valid callback whose `state` equals
/// `expected_state`, or `timeout` elapses. Anything else (favicon requests,
/// scanners, wrong state) is answered with 404 and ignored.
pub fn serve_one_callback(
    listener: &TcpListener,
    expected_state: &str,
    timeout: Duration,
) -> Option<Callback> {
    listener.set_nonblocking(true).ok()?;
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_nonblocking(false);
                let parsed = read_request_line(&mut stream)
                    .as_deref()
                    .and_then(parse_callback_request)
                    .filter(|cb| cb.state == expected_state);
                match parsed {
                    Some(cb) => {
                        respond(&mut stream, "200 OK", SUCCESS_PAGE);
                        return Some(cb);
                    }
                    None => respond(&mut stream, "404 Not Found", ""),
                }
            }
            Err(e) if e.kind() == ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => return None,
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const CODE: &str = "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo";
    const STATE: &str = "state_state-STATE-0123456789";

    #[test]
    fn accepts_valid_request_line() {
        let line = format!("GET /callback?code={CODE}&state={STATE} HTTP/1.1");
        assert_eq!(
            parse_callback_request(&line),
            Some(Callback { code: CODE.into(), state: STATE.into() })
        );
        let reversed = format!("GET /callback?state={STATE}&code={CODE} HTTP/1.1\r\n");
        assert!(parse_callback_request(&reversed).is_some());
    }

    #[test]
    fn rejects_other_methods_paths_and_versions() {
        let q = format!("code={CODE}&state={STATE}");
        assert_eq!(parse_callback_request(&format!("POST /callback?{q} HTTP/1.1")), None);
        assert_eq!(parse_callback_request(&format!("GET /favicon.ico?{q} HTTP/1.1")), None);
        assert_eq!(parse_callback_request(&format!("GET /callback/x?{q} HTTP/1.1")), None);
        assert_eq!(parse_callback_request(&format!("GET //callback?{q} HTTP/1.1")), None);
        assert_eq!(parse_callback_request(&format!("GET /callback?{q} HTTP/2")), None);
        assert_eq!(parse_callback_request(&format!("GET /callback?{q}")), None);
        assert_eq!(parse_callback_request(&format!("GET /callback?{q} HTTP/1.1 extra")), None);
        assert_eq!(parse_callback_request("GET /favicon.ico HTTP/1.1"), None);
        assert_eq!(parse_callback_request(""), None);
    }

    #[test]
    fn rejects_bad_parameters() {
        assert_eq!(parse_callback_request(&format!("GET /callback?code={CODE} HTTP/1.1")), None);
        assert_eq!(parse_callback_request(&format!("GET /callback?state={STATE} HTTP/1.1")), None);
        assert_eq!(
            parse_callback_request(&format!("GET /callback?code={CODE}&code={CODE}&state={STATE} HTTP/1.1")),
            None
        );
        assert_eq!(
            parse_callback_request(&format!("GET /callback?code={CODE}&state={STATE}&x=1 HTTP/1.1")),
            None
        );
        assert_eq!(
            parse_callback_request(&format!("GET /callback?code=short&state={STATE} HTTP/1.1")),
            None
        );
        assert_eq!(
            parse_callback_request(&format!("GET /callback?code={CODE}%3Cb&state={STATE} HTTP/1.1")),
            None
        );
        assert_eq!(
            parse_callback_request(&format!("GET /callback?code=<script>alert(1)</script>&state={STATE} HTTP/1.1")),
            None
        );
        let long = "a".repeat(129);
        assert_eq!(
            parse_callback_request(&format!("GET /callback?code={long}&state={STATE} HTTP/1.1")),
            None
        );
    }

    fn roundtrip(requests: Vec<String>, state: &str, timeout: Duration) -> Option<Callback> {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let sender = std::thread::spawn(move || {
            for req in requests {
                let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
                s.write_all(req.as_bytes()).unwrap();
                let mut sink = Vec::new();
                let _ = s.read_to_end(&mut sink);
            }
        });
        let result = serve_one_callback(&listener, state, timeout);
        let _ = sender.join();
        result
    }

    #[test]
    fn serves_one_callback_and_ignores_noise() {
        let result = roundtrip(
            vec![
                "GET /favicon.ico HTTP/1.1\r\nHost: x\r\n\r\n".into(),
                format!("GET /callback?code={CODE}&state=wrongwrongwrongwrong HTTP/1.1\r\n\r\n"),
                format!("GET /callback?code={CODE}&state={STATE} HTTP/1.1\r\nHost: x\r\n\r\n"),
            ],
            STATE,
            Duration::from_secs(10),
        );
        assert_eq!(result, Some(Callback { code: CODE.into(), state: STATE.into() }));
    }

    #[test]
    fn times_out_without_callback() {
        assert_eq!(roundtrip(vec![], STATE, Duration::from_millis(200)), None);
    }
}
