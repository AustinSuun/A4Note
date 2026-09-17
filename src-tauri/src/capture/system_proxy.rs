//! A narrow exception to direct pinned downloads, not a general proxy bypass.
//! Only the trusted arxiv.org origin may use an explicitly enabled Windows
//! static loopback HTTP proxy. Proxy-side DNS is delegated only for that host;
//! arbitrary capture URLs always retain the direct resolve/reject/pin policy.
use reqwest::{Proxy, Url};

pub(super) fn for_public_provider(url: &Url) -> Result<Option<Proxy>, String> {
    if url.scheme() != "https" || url.host_str() != Some("arxiv.org")
        || url.port_or_known_default() != Some(443) {
        return Ok(None);
    }
    let Some(server) = configured_loopback_proxy("arxiv.org") else { return Ok(None); };
    Proxy::https(server).map(Some).map_err(|_| "system_proxy_configuration_invalid".into())
}

#[cfg(not(windows))]
fn configured_loopback_proxy(_: &str) -> Option<String> { None }

#[cfg(windows)]
fn configured_loopback_proxy(host: &str) -> Option<String> {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD, RRF_RT_REG_SZ};
    fn wide(s: &str) -> Vec<u16> { s.encode_utf16().chain(Some(0)).collect() }
    let key = wide("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings");
    let mut enabled = 0u32;
    let mut size = std::mem::size_of::<u32>() as u32;
    let result = unsafe { RegGetValueW(HKEY_CURRENT_USER, key.as_ptr(), wide("ProxyEnable").as_ptr(),
        RRF_RT_REG_DWORD, std::ptr::null_mut(), (&mut enabled as *mut u32).cast(), &mut size) };
    if result != 0 || enabled != 1 { return None; }
    // Bounded REG_SZ only; do not execute PAC scripts, expand environment values,
    // read credentials, launch a shell or discover arbitrary proxy endpoints.
    let read_string = |name: &str| -> Option<String> {
        let mut buffer = vec![0u16; 2048];
        let mut bytes = (buffer.len() * 2) as u32;
        let result = unsafe { RegGetValueW(HKEY_CURRENT_USER, key.as_ptr(), wide(name).as_ptr(),
            RRF_RT_REG_SZ, std::ptr::null_mut(), buffer.as_mut_ptr().cast(), &mut bytes) };
        if result == 2 { return None; } // Missing optional setting.
        if result != 0 || bytes == 0 || bytes as usize > buffer.len() * 2 || bytes % 2 != 0 { return Some("*".into()); } // Fail closed.
        let units = &buffer[..bytes as usize / 2];
        String::from_utf16(units.split(|c| *c == 0).next()?).ok()
    };
    if read_string("AutoConfigURL").is_some_and(|value| !value.trim().is_empty()) { return None; }
    if read_string("ProxyOverride").is_some_and(|value| value.split(';').any(|pattern| {
        let pattern = pattern.trim().to_ascii_lowercase();
        pattern != "<local>" && wildcard_matches(&pattern, host)
    })) { return None; }
    let server = read_string("ProxyServer")?;
    let endpoint = if server.contains('=') {
        server.split(';').find_map(|entry| {
            let (protocol, endpoint) = entry.trim().split_once('=')?;
            protocol.trim().eq_ignore_ascii_case("https").then_some(endpoint.trim())
        })?
    } else { server.trim() };
    let raw = if endpoint.contains("://") { endpoint.to_string() } else { format!("http://{endpoint}") };
    let mut proxy = Url::parse(&raw).ok()?;
    if proxy.scheme() != "http" || !proxy.username().is_empty() || proxy.password().is_some()
        || proxy.query().is_some() || proxy.fragment().is_some() || proxy.path() != "/" {
        return None;
    }
    // Never resolve a proxy hostname supplied by a web page or registry alias.
    if proxy.host_str() == Some("localhost") { proxy.set_host(Some("127.0.0.1")).ok()?; }
    let ip: std::net::IpAddr = proxy.host_str()?.trim_start_matches('[').trim_end_matches(']').parse().ok()?;
    if !ip.is_loopback() || proxy.port_or_known_default()? == 0 { return None; }
    Some(proxy.to_string())
}

/// Windows proxy bypass patterns (* and ?), with bounded memory and input.
#[cfg(windows)]
fn wildcard_matches(pattern: &str, host: &str) -> bool {
    let mut previous = vec![false; host.len() + 1];
    previous[0] = true;
    for c in pattern.bytes() {
        let mut next = vec![false; host.len() + 1];
        next[0] = c == b'*' && previous[0];
        for (i, h) in host.bytes().enumerate() {
            next[i + 1] = if c == b'*' { previous[i + 1] || next[i] }
                else { previous[i] && (c == b'?' || c == h) };
        }
        previous = next;
    }
    previous[host.len()]
}
