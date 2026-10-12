use reqwest::blocking::Client;
use semver::Version;
use serde::{Deserialize, Serialize};
use std::{io::Read, time::Duration};

const API_URL: &str = "https://api.github.com/repos/kafuluote/utools/releases/latest";
const RELEASES_URL: &str = "https://github.com/kafuluote/utools/releases";
const MAX_RESPONSE: u64 = 1_000_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    current_version: String,
    latest_version: Option<String>,
    available: bool,
    download_url: String,
    release_url: String,
    notes: String,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    html_url: String,
    draft: bool,
    prerelease: bool,
    body: Option<String>,
    #[serde(default)]
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
}

fn no_release(current: &str) -> UpdateInfo {
    UpdateInfo {
        current_version: current.into(),
        latest_version: None,
        available: false,
        download_url: RELEASES_URL.into(),
        release_url: RELEASES_URL.into(),
        notes: String::new(),
    }
}

pub fn validate_url(value: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(value).map_err(|_| "下载地址无效。")?;
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || !(url.path() == "/kafuluote/utools/releases"
            || url.path().starts_with("/kafuluote/utools/releases/"))
    {
        return Err("只能打开本软件 GitHub 仓库的发布下载地址。".into());
    }
    Ok(())
}

fn parse_release(current: &str, release: Release) -> Result<UpdateInfo, String> {
    if release.draft || release.prerelease {
        return Ok(no_release(current));
    }
    let tag = release.tag_name.trim().trim_start_matches('v');
    let latest =
        Version::parse(tag).map_err(|_| "发布版标签格式无效，请使用 v主版本.次版本.修订版本。")?;
    if !latest.pre.is_empty() {
        return Ok(no_release(current));
    }
    let installed = Version::parse(current).map_err(|_| "当前软件版本格式无效。")?;
    validate_url(&release.html_url)?;
    // Prefer the installer built by package-windows.ps1 for this version and architecture.
    let installer = format!("exchange-tools-{latest}-windows-x64-setup.exe");
    let portable = format!("exchange-tools-{latest}-windows-x64-portable.zip");
    let download = [installer, portable]
        .iter()
        .find_map(|name| release.assets.iter().find(|asset| &asset.name == name))
        .filter(|asset| validate_url(&asset.browser_download_url).is_ok())
        .map(|asset| asset.browser_download_url.clone())
        .unwrap_or_else(|| release.html_url.clone());
    Ok(UpdateInfo {
        current_version: current.into(),
        latest_version: Some(latest.to_string()),
        available: latest.cmp_precedence(&installed).is_gt(),
        download_url: download,
        release_url: release.html_url,
        notes: release
            .body
            .unwrap_or_default()
            .chars()
            .take(8000)
            .collect(),
    })
}

pub fn check(current: &str) -> Result<UpdateInfo, String> {
    check_url(current, API_URL)
}

fn check_url(current: &str, api_url: &str) -> Result<UpdateInfo, String> {
    let client = Client::builder()
        .user_agent(format!("exchange-tools/{current}"))
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("无法创建更新检查请求：{e}"))?;
    let response = client
        .get(api_url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .map_err(|e| {
            if e.is_timeout() {
                "检查更新超时，请稍后重试。".into()
            } else {
                "无法连接 GitHub，请检查网络后重试。".to_string()
            }
        })?;
    match response.status().as_u16() {
        404 => return Ok(no_release(current)),
        403 | 429 => return Err("GitHub 暂时限制了请求，请稍后重试。".into()),
        200 => {}
        status => return Err(format!("检查更新失败（HTTP {status}），请稍后重试。")),
    }
    let mut bytes = Vec::new();
    response
        .take(MAX_RESPONSE + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "无法读取发布版信息，请重试。")?;
    if bytes.len() as u64 > MAX_RESPONSE {
        return Err("发布版信息过大。".into());
    }
    let release = serde_json::from_slice(&bytes).map_err(|_| "GitHub 返回的发布版信息无效。")?;
    parse_release(current, release)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mock_check(status: u16, body: &str) -> Result<UpdateInfo, String> {
        use std::{io::Write, net::TcpListener};
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let response = format!("HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = [0; 8192];
            let _ = stream.read(&mut request);
            // The oversized-response check may close the socket before all bytes are sent.
            let _ = stream.write_all(response.as_bytes());
        });
        let result = check_url("0.4.0", &format!("http://{address}/releases/latest"));
        server.join().unwrap();
        result
    }

    #[test]
    fn handles_github_responses_and_no_releases() {
        let result = mock_check(200, r#"{"tag_name":"v0.5.0","html_url":"https://github.com/kafuluote/utools/releases/tag/v0.5.0","draft":false,"prerelease":false,"body":null,"assets":[]}"#).unwrap();
        assert!(result.available);
        assert_eq!(result.latest_version.as_deref(), Some("0.5.0"));
        assert!(mock_check(404, "").unwrap().latest_version.is_none());
        for status in [403, 429, 500] {
            assert!(mock_check(status, "").is_err());
        }
        assert!(mock_check(200, "not JSON").is_err());
        assert!(mock_check(200, &"x".repeat(MAX_RESPONSE as usize + 1)).is_err());
    }

    fn release(tag: &str) -> Release {
        Release {
            tag_name: tag.into(),
            html_url: format!("{RELEASES_URL}/tag/{tag}"),
            draft: false,
            prerelease: false,
            body: Some("更新说明".into()),
            assets: vec![],
        }
    }

    #[test]
    fn versions_compare_numerically_and_ignore_build_metadata() {
        assert!(
            parse_release("0.4.0", release("v0.10.0"))
                .unwrap()
                .available
        );
        assert!(!parse_release("0.4.0", release("v0.4.0")).unwrap().available);
        assert!(!parse_release("0.4.0", release("v0.3.9")).unwrap().available);
        assert!(
            !parse_release("0.4.0+local", release("v0.4.0+release"))
                .unwrap()
                .available
        );
        assert!(
            parse_release("0.5.0-beta.1", release("v0.5.0"))
                .unwrap()
                .available
        );
        assert!(parse_release("0.4.0", release("latest")).is_err());
    }

    #[test]
    fn excludes_drafts_and_prereleases() {
        let mut candidate = release("v1.0.0");
        candidate.draft = true;
        assert!(!parse_release("0.4.0", candidate).unwrap().available);
        let mut candidate = release("v1.0.0");
        candidate.prerelease = true;
        assert!(!parse_release("0.4.0", candidate).unwrap().available);
        assert!(
            !parse_release("0.4.0", release("v1.0.0-beta.1"))
                .unwrap()
                .available
        );
    }

    #[test]
    fn prefers_matching_installer_and_falls_back_to_release_page() {
        let mut candidate = release("v0.5.0");
        let installer = format!("{RELEASES_URL}/download/v0.5.0/setup.exe");
        candidate.assets = vec![
            Asset {
                name: "exchange-tools-0.5.0-windows-x64-portable.zip".into(),
                browser_download_url: format!("{RELEASES_URL}/download/v0.5.0/portable.zip"),
            },
            Asset {
                name: "exchange-tools-0.5.0-windows-x64-setup.exe".into(),
                browser_download_url: installer.clone(),
            },
        ];
        assert_eq!(
            parse_release("0.4.0", candidate).unwrap().download_url,
            installer
        );
        let result = parse_release("0.4.0", release("v0.5.0")).unwrap();
        assert_eq!(result.download_url, result.release_url);
        assert!(no_release("0.4.0").latest_version.is_none());
    }

    #[test]
    fn rejects_untrusted_download_urls() {
        for url in [
            "http://github.com/kafuluote/utools/releases",
            "https://github.com.evil.test/kafuluote/utools/releases",
            "https://github.com/other/repo/releases",
            "https://github.com/kafuluote/utools/releases-evil",
            "https://user@github.com/kafuluote/utools/releases",
            "file:///C:/test.exe",
            "https://github.com:8443/kafuluote/utools/releases",
            "https://github.com/kafuluote/utools/releases/../../other",
        ] {
            assert!(validate_url(url).is_err(), "{url}");
        }
        assert!(validate_url(RELEASES_URL).is_ok());
    }
}
