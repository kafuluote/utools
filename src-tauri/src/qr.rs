use base64::{engine::general_purpose::STANDARD, Engine};
use image::{DynamicImage, GrayImage, ImageFormat, ImageReader, RgbaImage};
use serde::Serialize;
use std::{
    fs::File,
    io::{Cursor, Read},
    path::Path,
};

pub const MAX_BYTES: usize = 20 * 1024 * 1024;
pub const MAX_FILES: usize = 32;
const MAX_EDGE: u32 = 8192;
const MAX_PIXELS: u64 = 16_000_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Code {
    pub text: String,
    pub encoding: String,
    pub version: usize,
    pub bounds: [[i32; 2]; 4],
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub source: String,
    pub width: u32,
    pub height: u32,
    pub preview: Option<String>,
    pub codes: Vec<Code>,
    pub warning: Option<String>,
    pub error: Option<String>,
}

pub fn failure(source: String, error: String) -> Report {
    Report {
        source,
        width: 0,
        height: 0,
        preview: None,
        codes: vec![],
        warning: None,
        error: Some(error),
    }
}

fn check_dimensions(width: u32, height: u32) -> Result<(), String> {
    if width == 0
        || height == 0
        || width > MAX_EDGE
        || height > MAX_EDGE
        || u64::from(width) * u64::from(height) > MAX_PIXELS
    {
        return Err(
            "图片过大或尺寸无效：单边最多 8192 像素，总像素最多 1600 万。请裁剪二维码区域后重试。"
                .into(),
        );
    }
    Ok(())
}

pub fn load_bytes(bytes: &[u8]) -> Result<DynamicImage, String> {
    if bytes.len() > MAX_BYTES {
        return Err("图片不能超过 20 MB，请压缩或裁剪后重试。".into());
    }
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| "无法读取图片格式。")?;
    let (width, height) = reader
        .into_dimensions()
        .map_err(|_| "无法读取图片，请使用 PNG、JPG、WebP、BMP、GIF、TIFF 或 ICO 图片。")?;
    check_dimensions(width, height)?;
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| "无法读取图片格式。")?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_EDGE);
    limits.max_image_height = Some(MAX_EDGE);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    reader
        .decode()
        .map_err(|e| format!("图片无法解码，文件可能已损坏：{e}"))
}

pub fn decode_path(path: &Path) -> Report {
    let source = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let result = (|| {
        let file = File::open(path).map_err(|e| format!("无法打开图片：{e}"))?;
        if !file
            .metadata()
            .map_err(|e| format!("无法读取文件信息：{e}"))?
            .is_file()
        {
            return Err("请选择图片文件。".into());
        }
        // Bound the actual read as well as the metadata size; the file may change during reading.
        let mut bytes = Vec::new();
        file.take((MAX_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|e| format!("无法读取图片：{e}"))?;
        let image = load_bytes(&bytes)?;
        decode_image(image, source.clone())
    })();
    result.unwrap_or_else(|error| failure(source, error))
}

pub fn decode_bytes(bytes: &[u8], source: String) -> Report {
    load_bytes(bytes)
        .and_then(|img| decode_image(img, source.clone()))
        .unwrap_or_else(|error| failure(source, error))
}

pub fn clipboard_rgba(width: usize, height: usize, bytes: Vec<u8>) -> Result<DynamicImage, String> {
    let width = u32::try_from(width).map_err(|_| "剪贴板图片尺寸无效。")?;
    let height = u32::try_from(height).map_err(|_| "剪贴板图片尺寸无效。")?;
    check_dimensions(width, height)?;
    RgbaImage::from_raw(width, height, bytes)
        .map(DynamicImage::ImageRgba8)
        .ok_or_else(|| "剪贴板图片数据无效。".into())
}

fn payload_text(bytes: Vec<u8>) -> (String, String) {
    if let Ok(text) = std::str::from_utf8(&bytes) {
        if !text
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
        {
            return (text.to_owned(), "UTF-8".into());
        }
    } else {
        let (text, _, errors) = encoding_rs::GB18030.decode(&bytes);
        if !errors
            && !text
                .chars()
                .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
        {
            return (text.into_owned(), "GB18030（推测）".into());
        }
    }
    (
        bytes
            .iter()
            .map(|byte| format!("{byte:02X}"))
            .collect::<Vec<_>>()
            .join(" "),
        "二进制 · HEX".into(),
    )
}

fn detect(gray: &GrayImage) -> (Vec<Code>, usize) {
    let mut prepared = rqrr::PreparedImage::prepare(gray.clone());
    let grids = prepared.detect_grids();
    let mut failed = 0;
    let mut codes = Vec::new();
    for grid in grids {
        let mut bytes = Vec::new();
        match grid.decode_to(&mut bytes) {
            Ok(meta) => {
                let (text, encoding) = payload_text(bytes);
                codes.push(Code {
                    text,
                    encoding,
                    version: meta.version.0,
                    bounds: grid.bounds.map(|p| [p.x, p.y]),
                });
            }
            Err(_) => failed += 1,
        }
    }
    codes.sort_by_key(|code| {
        let x = code.bounds.iter().map(|p| p[0]).min().unwrap_or(0);
        let y = code.bounds.iter().map(|p| p[1]).min().unwrap_or(0);
        (y / 30, x)
    });
    (codes, failed)
}

pub fn decode_image(image: DynamicImage, source: String) -> Result<Report, String> {
    let (width, height) = (image.width(), image.height());
    check_dimensions(width, height)?;
    // Transparent pixels must be composited on white before luminance conversion.
    let mut rgba = image.to_rgba8();
    for pixel in rgba.pixels_mut() {
        let alpha = u32::from(pixel[3]);
        for channel in &mut pixel.0[..3] {
            *channel = ((u32::from(*channel) * alpha + 255 * (255 - alpha) + 127) / 255) as u8;
        }
        pixel[3] = 255;
    }
    let image = DynamicImage::ImageRgba8(rgba);
    let mut gray = image.to_luma8();
    let (mut codes, mut failed) = detect(&gray);
    if codes.is_empty() {
        image::imageops::invert(&mut gray);
        let (inverted, inverted_failed) = detect(&gray);
        codes = inverted;
        failed = failed.max(inverted_failed);
    }
    let mut preview = Cursor::new(Vec::new());
    image
        .thumbnail(640, 480)
        .write_to(&mut preview, ImageFormat::Png)
        .map_err(|e| format!("无法生成图片预览：{e}"))?;
    let error = if codes.is_empty() {
        Some(if failed > 0 { "发现二维码，但无法完整解码。请使用更清晰、完整的图片；平台专用码可能需要对应 App 识别。" } else { "未识别到二维码。请检查图片清晰度；平台专用码可能需要对应 App 识别。" }.into())
    } else {
        None
    };
    let warning = if !codes.is_empty() && failed > 0 {
        Some(format!(
            "另有 {failed} 个疑似二维码无法解码，请尝试裁剪或更清晰的图片。"
        ))
    } else {
        None
    };
    Ok(Report {
        source,
        width,
        height,
        preview: Some(format!(
            "data:image/png;base64,{}",
            STANDARD.encode(preview.into_inner())
        )),
        codes,
        warning,
        error,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Luma, Rgba};
    use qrcode::{Color, QrCode};

    fn qr(payload: &[u8]) -> GrayImage {
        let code = QrCode::new(payload).unwrap();
        let size = (code.width() + 8) as u32 * 8;
        GrayImage::from_fn(size, size, |x, y| {
            let (x, y) = (x as usize / 8, y as usize / 8);
            Luma([
                if x >= 4
                    && y >= 4
                    && x < code.width() + 4
                    && y < code.width() + 4
                    && code[(x - 4, y - 4)] == Color::Dark
                {
                    0
                } else {
                    255
                },
            ])
        })
    }

    #[test]
    fn decodes_unicode_whitespace_and_all_supported_formats() {
        let text = "本地二维码\nhttps://example.com/?a=1&b=2\n  保留空格  ";
        let image = DynamicImage::ImageLuma8(qr(text.as_bytes()));
        for format in [
            ImageFormat::Png,
            ImageFormat::Jpeg,
            ImageFormat::Bmp,
            ImageFormat::Gif,
            ImageFormat::WebP,
            ImageFormat::Tiff,
            ImageFormat::Ico,
        ] {
            let mut data = Cursor::new(Vec::new());
            let encoded = if format == ImageFormat::Jpeg {
                DynamicImage::ImageRgb8(image.to_rgb8())
            } else if format == ImageFormat::Ico {
                DynamicImage::ImageRgba8(
                    image
                        .resize_exact(256, 256, image::imageops::FilterType::Nearest)
                        .to_rgba8(),
                )
            } else {
                DynamicImage::ImageRgba8(image.to_rgba8())
            };
            encoded.write_to(&mut data, format).unwrap();
            let report = decode_bytes(data.get_ref(), "sample".into());
            assert!(report.error.is_none(), "{format:?}: {:?}", report.error);
            assert_eq!(report.codes[0].text, text, "{format:?}");
        }
    }

    #[test]
    fn decodes_rotation_inversion_and_transparency() {
        let image = qr(b"offline-test");
        let mut inverted = image.clone();
        image::imageops::invert(&mut inverted);
        let transparent = RgbaImage::from_fn(image.width(), image.height(), |x, y| {
            if image.get_pixel(x, y)[0] == 0 {
                Rgba([0, 0, 0, 255])
            } else {
                Rgba([0, 0, 0, 0])
            }
        });
        for image in [
            DynamicImage::ImageLuma8(image::imageops::rotate90(&image)),
            DynamicImage::ImageLuma8(inverted),
            DynamicImage::ImageRgba8(transparent),
        ] {
            assert_eq!(
                decode_image(image, "sample".into()).unwrap().codes[0].text,
                "offline-test"
            );
        }
    }

    #[test]
    fn detects_multiple_codes_including_identical_payloads() {
        let first = qr(b"same-payload");
        let second = qr("第二个二维码".as_bytes());
        let mut canvas = GrayImage::from_pixel(
            first.width() * 3 + 100,
            first.height().max(second.height()) + 40,
            Luma([255]),
        );
        image::imageops::overlay(&mut canvas, &first, 0, 0);
        image::imageops::overlay(&mut canvas, &first, i64::from(first.width()) + 30, 0);
        image::imageops::overlay(&mut canvas, &second, i64::from(first.width()) * 2 + 60, 0);
        let report = decode_image(DynamicImage::ImageLuma8(canvas), "batch".into()).unwrap();
        assert_eq!(report.codes.len(), 3);
        assert_eq!(
            report
                .codes
                .iter()
                .filter(|code| code.text == "same-payload")
                .count(),
            2
        );
        assert!(report.codes.iter().any(|code| code.text == "第二个二维码"));
    }

    #[test]
    fn handles_blank_corrupt_missing_and_oversized_images() {
        let blank = DynamicImage::ImageLuma8(GrayImage::from_pixel(100, 100, Luma([255])));
        let report = decode_image(blank, "blank".into()).unwrap();
        assert!(report.codes.is_empty() && report.error.is_some() && report.preview.is_some());
        assert!(decode_bytes(b"not an image", "broken".into())
            .error
            .is_some());
        assert!(decode_path(Path::new("does-not-exist.png")).error.is_some());
        assert!(load_bytes(&vec![0; MAX_BYTES + 1]).is_err());
        assert!(check_dimensions(8193, 1).is_err());
        assert!(check_dimensions(4096, 4096).is_err());
        assert!(clipboard_rgba(50, 50, vec![0; 4]).is_err());
    }

    #[test]
    fn preserves_gb18030_and_binary_payloads() {
        let (bytes, _, _) = encoding_rs::GB18030.encode("中文二维码");
        let report = decode_image(DynamicImage::ImageLuma8(qr(&bytes)), "gb".into()).unwrap();
        assert_eq!(report.codes[0].text, "中文二维码");
        assert!(report.codes[0].encoding.starts_with("GB18030"));
        assert_eq!(
            payload_text(vec![0, 255, 1]),
            ("00 FF 01".into(), "二进制 · HEX".into())
        );
    }
}
