//! Opaque supplementary files: bounded bytes + hash, never execute or extract.
use std::{fs::File, io::Read, path::Path};
use sha2::{Digest, Sha256};
pub(crate) fn extension(name: &str) -> Option<String> {
    let ext = name.rsplit('.').next()?.trim_matches('"').to_ascii_lowercase();
    matches!(ext.as_str(), "pdf"|"csv"|"tsv"|"txt"|"json"|"xml"|"xlsx"|"xls"|"docx"|"doc"|"pptx"|"ppt"|"zip"|"gz"|"tgz"|"tar"|"png"|"jpg"|"jpeg"|"gif"|"tif"|"tiff"|"webp"|"mp4"|"mov"|"avi"|"webm"|"mp3"|"wav"|"h5"|"hdf5"|"nc").then_some(ext)
}
pub(super) fn from_url(raw: &str) -> Option<String> {
    let url = reqwest::Url::parse(raw).ok()?;
    extension(url.path())
}
pub(crate) fn verify(path: &Path, ext: &str) -> Result<(String,u64),String> {
    if ext == "pdf" { return super::verify(path); }
    if extension(&format!("file.{ext}")).as_deref() != Some(ext) { return Err("unsupported_supplement_format".into()); }
    let mut file=File::open(path).map_err(|_|"attachment_read_failed")?;
    let meta=file.metadata().map_err(|_|"attachment_read_failed")?;
    let size=meta.len();
    if !meta.is_file() || size==0 || size>super::FILE_LIMIT { return Err("invalid_attachment_size".into()); }
    let mut prefix=[0u8;512];let n=file.read(&mut prefix).map_err(|_|"attachment_read_failed")?;
    let bytes=&prefix[..n];
    let text=String::from_utf8_lossy(bytes).trim_start_matches('\u{feff}').trim_start().to_ascii_lowercase();
    if bytes.starts_with(b"MZ") || bytes.starts_with(b"\x7fELF") || bytes.starts_with(b"#!") {
        return Err("executable_attachment_rejected".into());
    }
    if ["<!doctype html","<html","<head","<body","<script"].iter().any(|p|text.starts_with(p)) {
        return Err("attachment_is_html_or_login_page".into());
    }
    let signature_ok=match ext {
        "zip"|"xlsx"|"docx"|"pptx"=>bytes.starts_with(b"PK\x03\x04")||bytes.starts_with(b"PK\x05\x06"),
        "gz"|"tgz"=>bytes.starts_with(b"\x1f\x8b"),
        "xls"|"doc"|"ppt"=>bytes.starts_with(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"),
        "png"=>bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "jpg"|"jpeg"=>bytes.starts_with(b"\xff\xd8\xff"),
        "gif"=>bytes.starts_with(b"GIF87a")||bytes.starts_with(b"GIF89a"),
        "tif"|"tiff"=>bytes.starts_with(b"II*\0")||bytes.starts_with(b"MM\0*"),
        "webp"=>bytes.starts_with(b"RIFF")&&bytes.get(8..12)==Some(b"WEBP"),
        "mp4"|"mov"=>bytes.get(4..8)==Some(b"ftyp"),
        "avi"=>bytes.starts_with(b"RIFF")&&bytes.get(8..12)==Some(b"AVI "),
        "wav"=>bytes.starts_with(b"RIFF")&&bytes.get(8..12)==Some(b"WAVE"),
        "webm"=>bytes.starts_with(b"\x1a\x45\xdf\xa3"),
        _=>true, // Opaque research data: not parsed or declared semantically valid.
    };
    if !signature_ok { return Err("attachment_type_mismatch".into()); }
    let mut hash=Sha256::new();hash.update(bytes);
    let mut buf=[0u8;65536];let mut read=n as u64;
    loop {let n=file.read(&mut buf).map_err(|_|"attachment_read_failed")?;if n==0{break;}read+=n as u64;if read>super::FILE_LIMIT{return Err("invalid_attachment_size".into());}hash.update(&buf[..n]);}
    if read!=size{return Err("attachment_changed_during_read".into());}
    Ok((format!("{:x}",hash.finalize()),size))
}
