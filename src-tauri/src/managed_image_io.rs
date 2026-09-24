//! Bounded raster validation and new, durable managed assets. No arbitrary output filenames.
use std::{fs, io::{Cursor, Read, Write}, path::{Component, Path, PathBuf}};
use image::{ImageFormat, ImageReader, Limits};

pub(crate) const MAX_IMAGE: usize = 3 * 1024 * 1024;
const MAX_PIXELS: u64 = 16_000_000;

pub(crate) fn validate(bytes: &[u8], mime: Option<&str>) -> Result<&'static str, String> {
    if bytes.is_empty() || bytes.len() > MAX_IMAGE { return Err("图片为空或超过3MB".into()); }
    let format = image::guess_format(bytes).map_err(|_| "图片格式无法识别")?;
    let (ext, expected) = match format {
        ImageFormat::Png => ("png", "image/png"),
        ImageFormat::Jpeg => ("jpg", "image/jpeg"),
        ImageFormat::WebP => ("webp", "image/webp"),
        _ => return Err("仅支持PNG、JPEG、WebP图片".into()),
    };
    if mime.is_some_and(|value| value != expected) { return Err("图片MIME与实际格式不符".into()); }
    let (width, height) = ImageReader::with_format(Cursor::new(bytes), format).into_dimensions()
        .map_err(|_| "图片头损坏或尺寸无法读取")?;
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err("图片尺寸过大，请缩小到1600万像素以内".into());
    }
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = Limits::default();
    limits.max_image_width = Some(width); limits.max_image_height = Some(height);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    // A magic header is not an image. Fully decode within limits before writing.
    reader.decode().map_err(|_| "图片损坏、解码失败或超过内存限制")?;
    Ok(ext)
}

pub(crate) fn reject_link(metadata: &fs::Metadata) -> Result<(), String> {
    if metadata.file_type().is_symlink() { return Err("图片资源路径不允许符号链接".into()); }
    #[cfg(windows)] {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 { return Err("图片资源路径不允许Windows联接点或reparse链接".into()); }
    }
    Ok(())
}

/// Keep every Windows ancestor open without FILE_SHARE_DELETE until I/O completes.
/// This prevents swapping a checked directory for a junction during the operation.
pub(crate) struct DirectoryGuard { pub path: PathBuf, _handles: Vec<fs::File> }
impl DirectoryGuard {
    pub fn open(path: &Path, create: bool) -> Result<Self, String> {
        if !path.is_absolute() { return Err("图片资源目录必须是已授权的绝对路径".into()); }
        let mut current = PathBuf::new(); let mut handles = Vec::new();
        for component in path.components() {
            match component {
                Component::ParentDir | Component::CurDir => return Err("图片路径不允许相对跳转".into()),
                #[cfg(windows)]
                Component::Prefix(prefix) => {
                    use std::path::Prefix;
                    if !matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)) { return Err("图片目录不支持网络或设备路径".into()); }
                    current.push(component); continue;
                },
                _ => current.push(component),
            }
            let metadata = match fs::symlink_metadata(&current) {
                Ok(metadata) => metadata,
                Err(error) if create && error.kind() == std::io::ErrorKind::NotFound => {
                    match fs::create_dir(&current) {
                        Ok(()) => {},
                        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {},
                        Err(error) => return Err(format!("无法创建图片资源目录：{error}")),
                    }
                    fs::symlink_metadata(&current).map_err(|e| e.to_string())?
                },
                Err(error) => return Err(error.to_string()),
            };
            reject_link(&metadata)?;
            if !metadata.is_dir() { return Err("图片资源目录被同名文件占用".into()); }
            #[cfg(windows)] {
                use std::os::windows::fs::OpenOptionsExt;
                use windows_sys::Win32::Storage::FileSystem::{FILE_READ_ATTRIBUTES, FILE_LIST_DIRECTORY, FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT};
                let handle = fs::OpenOptions::new().access_mode(FILE_READ_ATTRIBUTES | FILE_LIST_DIRECTORY).share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
                    .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT).open(&current).map_err(|e| e.to_string())?;
                let opened = handle.metadata().map_err(|e| e.to_string())?; reject_link(&opened)?;
                if !opened.is_dir() { return Err("图片目录在检查期间发生变化".into()); }
                handles.push(handle);
            }
            #[cfg(not(windows))] { handles.push(fs::File::open(&current).map_err(|e| e.to_string())?); }
        }
        Ok(Self { path: current, _handles: handles })
    }
}

pub(crate) fn create(directory: &Path, bytes: &[u8], mime: Option<&str>) -> Result<String, String> {
    let extension = validate(bytes, mime)?;
    create_with(directory, bytes, extension, |file, bytes| file.write_all(bytes).and_then(|_| file.sync_all()))
}
fn create_with(directory: &Path, bytes: &[u8], extension: &str, write: impl FnOnce(&mut fs::File, &[u8]) -> std::io::Result<()>) -> Result<String, String> {
    let guard = DirectoryGuard::open(directory, true)?;
    let name = format!("{}.{}", uuid::Uuid::new_v4(), extension);
    let path = guard.path.join(&name);
    // UUID + create_new: concurrent imports cannot overwrite an existing asset.
    // The reference is returned only after all bytes and metadata have been synced.
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&path).map_err(|e| format!("图片写入失败：{e}"))?;
    if let Err(error) = write(&mut file, bytes) {
        drop(file); let _ = fs::remove_file(&path);
        return Err(format!("图片未完整写入，正文未修改：{error}"));
    }
    Ok(name)
}

pub(crate) fn read(directory: &Path, name: &str) -> Result<Vec<u8>, String> {
    if name.is_empty() || name.len() > 80 || name.starts_with('.') || !name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'.') {
        return Err("无效的托管图片引用".into());
    }
    let guard = DirectoryGuard::open(directory, false)?; let path = guard.path.join(name);
    let metadata = fs::symlink_metadata(&path).map_err(|e| format!("图片资源缺失：{e}"))?; reject_link(&metadata)?;
    if !metadata.is_file() || metadata.len() > MAX_IMAGE as u64 { return Err("图片资源不是3MB以内的文件".into()); }
    let mut options = fs::OpenOptions::new(); options.read(true);
    #[cfg(windows)] {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{FILE_SHARE_READ, FILE_FLAG_OPEN_REPARSE_POINT};
        options.share_mode(FILE_SHARE_READ).custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = options.open(&path).map_err(|e| e.to_string())?;
    reject_link(&file.metadata().map_err(|e| e.to_string())?)?;
    let mut bytes = Vec::new(); file.take(MAX_IMAGE as u64 + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    validate(&bytes, None)?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture { fn new() -> Self { let path = std::env::temp_dir().join(format!("a4-image-{}", uuid::Uuid::new_v4())); fs::create_dir(&path).unwrap(); Self(path) } }
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
    fn png() -> Vec<u8> { let mut out = Cursor::new(Vec::new()); image::DynamicImage::new_rgb8(2, 3).write_to(&mut out, ImageFormat::Png).unwrap(); out.into_inner() }
    #[test] fn managed_image_validates_full_raster_and_mime() {
        let bytes = png(); assert_eq!(validate(&bytes, Some("image/png")).unwrap(), "png");
        assert!(validate(&bytes, Some("image/jpeg")).is_err());
        for bytes in [b"\x89PNG\r\n\x1a\n".as_slice(), b"<svg/>".as_slice(), b"".as_slice()] { assert!(validate(bytes, None).is_err()); }
        assert!(validate(&vec![0; MAX_IMAGE + 1], None).is_err());
        assert!(validate(&png()[..30], None).is_err());
    }
    #[test] fn managed_image_supports_jpeg_and_webp() {
        for (format, mime, extension) in [(ImageFormat::Jpeg, "image/jpeg", "jpg"), (ImageFormat::WebP, "image/webp", "webp")] {
            let mut bytes = Cursor::new(Vec::new()); image::DynamicImage::new_rgb8(3, 2).write_to(&mut bytes, format).unwrap();
            assert_eq!(validate(bytes.get_ref(), Some(mime)).unwrap(), extension);
        }
    }
    #[test] fn managed_image_partial_write_failure_removes_unpublished_file() {
        let f = Fixture::new(); let bytes = png(); let directory = f.0.join("partial.assets");
        let result = create_with(&directory, &bytes, validate(&bytes, None).unwrap(), |file, bytes| {
            file.write_all(&bytes[..8])?;
            Err(std::io::Error::new(std::io::ErrorKind::StorageFull, "injected disk full"))
        });
        assert!(result.is_err()); assert_eq!(fs::read_dir(&directory).unwrap().count(), 0);
    }
    #[test] fn managed_image_rejects_oversize_pixels_before_decode() {
        let image = image::DynamicImage::new_rgb8(4001, 4000); let mut output = Cursor::new(Vec::new());
        image.write_to(&mut output, ImageFormat::Png).unwrap(); assert!(output.get_ref().len() < MAX_IMAGE);
        assert!(validate(output.get_ref(), None).unwrap_err().contains("1600万"));
    }
    #[test] fn managed_image_creates_unique_durable_assets_and_reopens() {
        let f = Fixture::new(); let dir = f.0.join("paper.assets"); let bytes = png();
        let a = create(&dir, &bytes, Some("image/png")).unwrap(); let b = create(&dir, &bytes, Some("image/png")).unwrap();
        assert_ne!(a, b); assert_eq!(read(&dir, &a).unwrap(), bytes); assert_eq!(read(&dir, &b).unwrap(), bytes);
        for name in ["../x.png", "x/y.png", "C:\\x.png", ".hidden", ""] { assert!(read(&dir, name).is_err()); }
    }
    #[test] fn managed_image_failures_do_not_create_assets_or_overwrite() {
        let f = Fixture::new(); let dir = f.0.join("bad.assets"); assert!(create(&dir, b"bad", None).is_err()); assert!(!dir.exists());
        fs::write(&dir, "keep").unwrap(); assert!(create(&dir, &png(), None).is_err()); assert_eq!(fs::read(&dir).unwrap(), b"keep");
        assert!(DirectoryGuard::open(Path::new("relative/assets"), true).is_err());
    }
    #[cfg(windows)]
    #[test] fn managed_image_rejects_windows_junction_and_pins_directory() {
        use std::process::Command;
        let f = Fixture::new(); let real = f.0.join("real"); fs::create_dir(&real).unwrap(); let link = f.0.join("link");
        let result = Command::new("cmd.exe").args(["/d", "/c", "mklink", "/J"]).arg(&link).arg(&real).output().unwrap();
        assert!(result.status.success(), "junction fixture failed: {:?}", result);
        assert!(create(&link, &png(), None).is_err()); assert!(fs::read_dir(&real).unwrap().next().is_none()); fs::remove_dir(link).unwrap();
        let guard = DirectoryGuard::open(&real, false).unwrap(); assert!(fs::rename(&real, f.0.join("moved")).is_err()); drop(guard);
        fs::rename(&real, f.0.join("moved")).unwrap();
    }
    #[cfg(unix)]
    #[test] fn managed_image_rejects_symlinks() {
        let f = Fixture::new(); let real = f.0.join("real"); fs::create_dir(&real).unwrap(); let link = f.0.join("link");
        std::os::unix::fs::symlink(&real, &link).unwrap(); assert!(create(&link, &png(), None).is_err());
    }
}
