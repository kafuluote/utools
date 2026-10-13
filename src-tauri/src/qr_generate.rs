use base64::{engine::general_purpose::STANDARD, Engine};
use image::{DynamicImage, GrayImage, ImageFormat, Luma};
use qrcode::{Color, EcLevel, QrCode};
use serde::Serialize;
use std::io::Cursor;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedQr {
    pub preview: String,
    pub size: u32,
    pub bytes: usize,
    pub version: usize,
    pub pixels_per_module: u32,
}

pub fn render(text: &str, size: u32, correction: &str) -> Result<(GrayImage, usize, u32), String> {
    if text.trim().is_empty() {
        return Err("请输入需要生成二维码的文本或网址。".into());
    }
    if text.len() > 2953 {
        return Err("内容不能超过 2953 个 UTF-8 字节，请缩短文本。".into());
    }
    if ![256, 512, 1024].contains(&size) {
        return Err("图片尺寸只能选择 256、512 或 1024 像素。".into());
    }
    let level = match correction {
        "L" => EcLevel::L,
        "M" => EcLevel::M,
        "Q" => EcLevel::Q,
        "H" => EcLevel::H,
        _ => return Err("纠错级别无效。".into()),
    };
    let code = QrCode::with_error_correction_level(text.as_bytes(), level)
        .map_err(|_| "内容超过当前纠错级别的容量，请缩短内容或选择较低的纠错级别。")?;
    let modules = code.width() as u32;
    let scale = size / (modules + 8);
    let offset = (size - (modules + 8) * scale) / 2 + 4 * scale;
    // Integer-sized modules and at least four white modules on every side.
    let image = GrayImage::from_fn(size, size, |x, y| {
        let dark = x >= offset
            && y >= offset
            && x < offset + modules * scale
            && y < offset + modules * scale
            && code[(
                ((x - offset) / scale) as usize,
                ((y - offset) / scale) as usize,
            )] == Color::Dark;
        Luma([if dark { 0 } else { 255 }])
    });
    Ok((image, ((modules - 17) / 4) as usize, scale))
}

fn encode_png(image: GrayImage) -> Result<Vec<u8>, String> {
    let mut bytes = Cursor::new(Vec::new());
    DynamicImage::ImageLuma8(image)
        .write_to(&mut bytes, ImageFormat::Png)
        .map_err(|e| format!("生成 PNG 图片失败：{e}"))?;
    Ok(bytes.into_inner())
}

pub fn png(text: &str, size: u32, correction: &str) -> Result<Vec<u8>, String> {
    encode_png(render(text, size, correction)?.0)
}

pub fn generate(text: &str, size: u32, correction: &str) -> Result<GeneratedQr, String> {
    let (image, version, pixels_per_module) = render(text, size, correction)?;
    Ok(GeneratedQr {
        preview: format!(
            "data:image/png;base64,{}",
            STANDARD.encode(encode_png(image)?)
        ),
        size,
        bytes: text.len(),
        version,
        pixels_per_module,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_unicode_urls_and_whitespace_at_each_setting() {
        let text = "  本地生成 😊\nhttps://example.com/?a=1&b=%E4%B8%AD\n  ";
        for size in [256, 512, 1024] {
            for correction in ["L", "M", "Q", "H"] {
                let data = png(text, size, correction).unwrap();
                let report = crate::qr::decode_bytes(&data, "generated.png".into());
                assert_eq!((report.width, report.height), (size, size));
                assert_eq!(
                    report.codes.len(),
                    1,
                    "{size}/{correction}: {:?}",
                    report.error
                );
                assert_eq!(report.codes[0].text, text);
            }
        }
    }

    #[test]
    fn limits_and_capacity_errors_are_reported() {
        for text in ["", " \n\t", &"a".repeat(2954)] {
            assert!(render(text, 512, "M").is_err());
        }
        assert!(render("valid", 123, "M").is_err());
        assert!(render("valid", 512, "invalid").is_err());
        assert!(render(&"é".repeat(1000), 512, "H").is_err());
        assert!(render(&"é".repeat(1000), 1024, "L").is_ok());
    }

    #[test]
    fn preview_and_saved_png_are_identical_with_white_quiet_zone() {
        let generated = generate("同一份图片", 512, "M").unwrap();
        let bytes = STANDARD
            .decode(
                generated
                    .preview
                    .strip_prefix("data:image/png;base64,")
                    .unwrap(),
            )
            .unwrap();
        assert_eq!(bytes, png("同一份图片", 512, "M").unwrap());
        assert_eq!(generated.bytes, "同一份图片".len());
        let image = image::load_from_memory(&bytes).unwrap().to_luma8();
        let border = 4 * generated.pixels_per_module;
        assert!(image
            .enumerate_pixels()
            .filter(|(x, y, _)| *x < border
                || *y < border
                || *x >= 512 - border
                || *y >= 512 - border)
            .all(|(_, _, pixel)| pixel[0] == 255));
    }
}
