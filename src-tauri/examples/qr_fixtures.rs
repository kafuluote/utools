//! Generate deterministic images for the desktop smoke test.
use image::{DynamicImage, GrayImage, Luma};
use qrcode::{Color, QrCode};
use std::{borrow::Cow, path::PathBuf};

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

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let directory = PathBuf::from(args.get(1).expect("Provide an output directory"));
    std::fs::create_dir_all(&directory).unwrap();
    let sample = qr(b"https://example.com/local-qr?offline=true");
    let chinese = qr("本地二维码测试\n无需上传图片".as_bytes());
    sample.save(directory.join("sample.png")).unwrap();
    chinese.save(directory.join("chinese.png")).unwrap();
    GrayImage::from_pixel(320, 240, Luma([255]))
        .save(directory.join("blank.png"))
        .unwrap();
    let mut multi = GrayImage::from_pixel(
        sample.width() + chinese.width() + 40,
        sample.height().max(chinese.height()),
        Luma([255]),
    );
    image::imageops::overlay(&mut multi, &sample, 0, 0);
    image::imageops::overlay(&mut multi, &chinese, i64::from(sample.width()) + 40, 0);
    multi.save(directory.join("multi.png")).unwrap();
    if args.get(2).is_some_and(|arg| arg == "--clipboard") {
        let rgba = DynamicImage::ImageLuma8(sample).to_rgba8();
        arboard::Clipboard::new()
            .unwrap()
            .set_image(arboard::ImageData {
                width: rgba.width() as usize,
                height: rgba.height() as usize,
                bytes: Cow::Owned(rgba.into_raw()),
            })
            .unwrap();
    }
    println!("Generated fixtures in {}", directory.display());
}
