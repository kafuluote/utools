mod qr;
mod updates;

use std::path::Path;

async fn work<T, F>(job: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|e| format!("处理任务失败：{e}"))?
}

#[tauri::command]
async fn pick_qr_images(window: tauri::WebviewWindow) -> Result<Option<Vec<qr::Report>>, String> {
    work(move || {
        let paths = rfd::FileDialog::new()
            .set_parent(&window)
            .set_title("选择二维码图片（可多选）")
            .add_filter(
                "图片",
                &[
                    "png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff", "ico",
                ],
            )
            .pick_files();
        match paths {
            None => Ok(None),
            Some(paths) => {
                if paths.len() > qr::MAX_FILES {
                    return Err("每次最多选择 32 张图片。".into());
                }
                Ok(Some(
                    paths.iter().map(|path| qr::decode_path(path)).collect(),
                ))
            }
        }
    })
    .await
}

#[tauri::command]
async fn decode_qr_paths(paths: Vec<String>) -> Result<Vec<qr::Report>, String> {
    if paths.is_empty() || paths.len() > qr::MAX_FILES {
        return Err("每次请选择 1 至 32 张图片。".into());
    }
    work(move || {
        Ok(paths
            .iter()
            .map(|path| qr::decode_path(Path::new(path)))
            .collect())
    })
    .await
}

#[tauri::command]
async fn decode_qr_bytes(bytes: Vec<u8>, source: String) -> Result<Vec<qr::Report>, String> {
    work(move || Ok(vec![qr::decode_bytes(&bytes, source)])).await
}

#[tauri::command]
async fn decode_qr_clipboard() -> Result<Vec<qr::Report>, String> {
    work(|| {
        let mut clipboard =
            arboard::Clipboard::new().map_err(|e| format!("无法访问剪贴板：{e}"))?;
        let image = clipboard
            .get_image()
            .map_err(|_| "剪贴板中没有可读取的图片。请先复制图片或截取二维码区域，再粘贴解码。")?;
        let image = qr::clipboard_rgba(image.width, image.height, image.bytes.into_owned())?;
        Ok(vec![qr::decode_image(image, "剪贴板图片".into())?])
    })
    .await
}

#[tauri::command]
async fn copy_qr_text(text: String) -> Result<(), String> {
    if text.len() > 1_000_000 {
        return Err("复制内容过大。".into());
    }
    work(move || {
        arboard::Clipboard::new()
            .map_err(|e| format!("无法访问剪贴板：{e}"))?
            .set_text(text)
            .map_err(|e| format!("复制失败：{e}"))
    })
    .await
}

#[tauri::command]
async fn save_qr_text(
    window: tauri::WebviewWindow,
    text: String,
) -> Result<Option<String>, String> {
    if text.len() > 1_000_000 {
        return Err("导出内容过大。".into());
    }
    work(move || {
        let path = rfd::FileDialog::new()
            .set_parent(&window)
            .set_title("导出解码结果")
            .set_file_name("二维码解码结果.txt")
            .add_filter("文本文件", &["txt"])
            .save_file();
        if let Some(path) = path {
            std::fs::write(&path, text.as_bytes()).map_err(|e| format!("无法保存文件：{e}"))?;
            Ok(Some(path.to_string_lossy().into_owned()))
        } else {
            Ok(None)
        }
    })
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            pick_qr_images,
            decode_qr_paths,
            decode_qr_bytes,
            decode_qr_clipboard,
            copy_qr_text,
            save_qr_text,
            copy_json_text,
            save_json_text,
            check_app_update,
            open_update_download
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
async fn check_app_update(app: tauri::AppHandle) -> Result<updates::UpdateInfo, String> {
    let version = app.package_info().version.to_string();
    work(move || updates::check(&version)).await
}

#[tauri::command]
async fn open_update_download(url: String) -> Result<(), String> {
    updates::validate_url(&url)?;
    work(move || open::that_detached(url).map_err(|e| format!("无法打开下载页面：{e}"))).await
}

#[tauri::command]
async fn copy_json_text(text: String) -> Result<(), String> {
    if text.len() > 5_000_000 {
        return Err("复制内容不能超过 5 MB。".into());
    }
    work(move || {
        arboard::Clipboard::new()
            .map_err(|e| format!("无法访问剪贴板：{e}"))?
            .set_text(text)
            .map_err(|e| format!("复制失败：{e}"))
    })
    .await
}

#[tauri::command]
async fn save_json_text(
    window: tauri::WebviewWindow,
    text: String,
) -> Result<Option<String>, String> {
    if text.len() > 5_000_000 {
        return Err("导出内容不能超过 5 MB。".into());
    }
    work(move || {
        let path = rfd::FileDialog::new()
            .set_parent(&window)
            .set_title("导出 JSON")
            .set_file_name("解析结果.json")
            .add_filter("JSON 文件", &["json"])
            .save_file();
        if let Some(path) = path {
            std::fs::write(&path, text.as_bytes()).map_err(|e| format!("无法保存文件：{e}"))?;
            Ok(Some(path.to_string_lossy().into_owned()))
        } else {
            Ok(None)
        }
    })
    .await
}
