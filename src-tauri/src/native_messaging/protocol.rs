//! Chromium native messaging framing. No HTTP, Tauri, filesystem or stdout logging.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{self, Read, Write};

pub const MAX_FRAME: usize = 1024 * 1024;
pub const PDF_CHUNK_BYTES: usize = 192 * 1024;

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Operation {
    Hello, RequestAccess, Submit, ListTasks, ListFolders, PdfBegin, PdfChunk, PdfFinish, PdfAbort,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub id: u32,
    pub operation: Operation,
    #[serde(default)]
    pub payload: Value,
}

pub fn decode_request(value: Value) -> Result<Request, String> {
    let request: Request = serde_json::from_value(value).map_err(|_| "invalid_native_request")?;
    if request.id == 0 { return Err("invalid_request_id".into()); }
    Ok(request)
}

pub fn read_frame(reader: &mut impl Read) -> Result<Option<Value>, String> {
    let mut prefix = [0u8; 4];
    loop {
        match reader.read(&mut prefix[..1]) {
            Ok(0) => return Ok(None),
            Ok(_) => break,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(_) => return Err("native_read_failed".into()),
        }
    }
    reader.read_exact(&mut prefix[1..]).map_err(|_| "truncated_native_header")?;
    // Chromium specifies host native endianness (little endian on supported Windows x64).
    let length = u32::from_ne_bytes(prefix) as usize;
    if length == 0 || length > MAX_FRAME { return Err("native_message_size_limit".into()); }
    let mut bytes = vec![0; length];
    reader.read_exact(&mut bytes).map_err(|_| "truncated_native_message")?;
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "invalid_native_json")?;
    if !value.is_object() { return Err("native_object_required".into()); }
    Ok(Some(value))
}

pub fn write_frame(writer: &mut impl Write, value: &Value) -> Result<(), String> {
    if !value.is_object() { return Err("native_object_required".into()); }
    let bytes = serde_json::to_vec(value).map_err(|_| "native_encode_failed")?;
    if bytes.len() > MAX_FRAME { return Err("native_message_size_limit".into()); }
    writer.write_all(&(bytes.len() as u32).to_ne_bytes()).map_err(|_| "native_write_failed")?;
    writer.write_all(&bytes).map_err(|_| "native_write_failed")?;
    writer.flush().map_err(|_| "native_flush_failed".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Cursor;
    #[test]
    fn native_protocol_multiple_unicode_frames_and_clean_eof() {
        let first=json!({"id":1,"operation":"submit","payload":{"title":"论文📄"}});
        let second=json!({"id":2,"operation":"hello"});
        let mut wire=Vec::new();write_frame(&mut wire,&first).unwrap();write_frame(&mut wire,&second).unwrap();
        let mut reader=Cursor::new(wire);
        assert_eq!(read_frame(&mut reader).unwrap(),Some(first));
        let request=decode_request(read_frame(&mut reader).unwrap().unwrap()).unwrap();
        assert_eq!(request.id,2);assert_eq!(request.operation,Operation::Hello);assert!(request.payload.is_null());
        assert_eq!(read_frame(&mut reader).unwrap(),None);
    }
    #[test]
    fn native_protocol_rejects_truncation_oversize_and_non_objects() {
        for data in [vec![1], vec![1,0,0], vec![3,0,0,0,b'{']]{assert!(read_frame(&mut Cursor::new(data)).is_err());}
        for length in [0u32,MAX_FRAME as u32+1,u32::MAX]{assert!(read_frame(&mut Cursor::new(length.to_ne_bytes())).is_err());}
        for bytes in [b"[]".as_slice(),b"{}garbage".as_slice(),b"{\xff}".as_slice()]{
            let mut frame=(bytes.len() as u32).to_ne_bytes().to_vec();frame.extend_from_slice(bytes);
            assert!(read_frame(&mut Cursor::new(frame)).is_err());
        }
        assert!(write_frame(&mut Vec::new(),&json!({"data":"x".repeat(MAX_FRAME)})).is_err());
    }
    #[test]
    fn native_protocol_rejects_unknown_operations_and_client_identity_override() {
        for value in [json!({"id":0,"operation":"hello"}),json!({"id":1,"operation":"execute_shell"}),json!({"id":1,"operation":"hello","origin":"forged"})]{assert!(decode_request(value).is_err());}
        assert!(PDF_CHUNK_BYTES*4/3+4096<MAX_FRAME);
    }
    #[test]
    fn native_protocol_propagates_output_failure() {
        struct Broken;
        impl Write for Broken {fn write(&mut self,_:&[u8])->io::Result<usize>{Err(io::ErrorKind::BrokenPipe.into())}fn flush(&mut self)->io::Result<()>{Ok(())}}
        assert!(write_frame(&mut Broken,&json!({"id":1})).is_err());
    }
}
