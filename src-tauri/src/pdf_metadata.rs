//! Title, author, DOI and year guessing from a PDF (P2-1).
//!
//! A draft, never a decision: everything here is scored heuristics over the first
//! page's text, and the import dialog shows the result for the user to correct.
//! The scoring is deliberately conservative — a wrong-but-confident title costs
//! more than an empty field, so a line has to look like a title to win.
//!
//! Text extraction is a minimal uncompressed-stream reader, not a full parser.
//! When it finds nothing usable the filename is the fallback source.

use serde::Serialize;
use std::cmp::Ordering;
use std::fs;
use std::path::{Path, PathBuf};

use crate::database::FALLBACK_TAG;

#[derive(Debug, Serialize)]
pub(crate) struct MetadataDraft {
    pub(crate) title: String,
    pub(crate) authors: String,
    pub(crate) year: Option<i64>,
    pub(crate) venue: String,
    pub(crate) doi: String,
    pub(crate) tags: Vec<String>,
    pub(crate) source: String,
    pub(crate) warnings: Vec<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct ScoredLine {
    pub(crate) index: usize,
    pub(crate) line: String,
    pub(crate) score: i32,
}

#[tauri::command]
pub fn extract_pdf_metadata(original_path: String) -> Result<MetadataDraft, String> {
    Ok(extract_metadata_from_pdf_path(&original_path))
}

pub(crate) fn extract_metadata_from_pdf_path(original_path: &str) -> MetadataDraft {
    let mut draft = metadata_from_filename(original_path);
    let path = PathBuf::from(original_path);
    if !path.exists() {
        draft
            .warnings
            .push("PDF file not found; used filename only".to_string());
        return draft;
    }

    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) => {
            draft.warnings.push(format!(
                "Failed to read PDF content: {error}. Used filename only as draft."
            ));
            return draft;
        }
    };

    let text = extract_pdf_text(&path, &bytes);
    if text.trim().is_empty() {
        draft.warnings.push(
            "Could not extract readable text from PDF content; used filename only.".to_string(),
        );
        return draft;
    }

    let candidates = top_candidate_lines(&text, 36);
    if let Some(title) = choose_title(&candidates) {
        draft.title = title.line.clone();
        draft.source = "pdf_text".to_string();
        if let Some(authors) = choose_authors(&candidates, title.index) {
            draft.authors = authors.line;
        }
    }

    if let Some(doi) = find_doi(&text) {
        draft.doi = doi;
        draft.source = "pdf_text".to_string();
    }

    if draft.year.is_none() {
        if let Some(year) = find_year_near_top(&text) {
            draft.year = Some(year);
            draft.source = "pdf_text".to_string();
        }
    }

    if draft.source == "filename" {
        draft
            .warnings
            .push("PDF text extraction is limited; used filename as fallback.".to_string());
    }
    draft
}

pub(crate) fn metadata_from_filename(original_path: &str) -> MetadataDraft {
    let file_name = Path::new(original_path)
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("Untitled");
    let cleaned = file_name
        .replace(['_', '-'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    MetadataDraft {
        title: if cleaned.trim().is_empty() {
            "Untitled".to_string()
        } else {
            cleaned.trim().to_string()
        },
        authors: String::new(),
        year: find_year_anywhere(file_name),
        venue: String::new(),
        doi: String::new(),
        tags: vec![FALLBACK_TAG.to_string()],
        source: "filename".to_string(),
        warnings: Vec::new(),
    }
}

pub(crate) fn extract_pdf_text(path: &Path, bytes: &[u8]) -> String {
    if let Ok(text) = pdf_extract::extract_text(path) {
        let cleaned = clean_pdf_text(&text);
        if !cleaned.trim().is_empty() {
            return cleaned;
        }
    }
    clean_pdf_text(&extract_ascii_pdf_text(bytes))
}

pub(crate) fn extract_ascii_pdf_text(bytes: &[u8]) -> String {
    let limited = &bytes[..bytes.len().min(512_000)];
    let mut output = String::new();
    let mut current = String::new();
    for byte in limited {
        let ch = *byte as char;
        if ch.is_ascii_graphic() || ch == ' ' {
            current.push(ch);
        } else {
            if current.len() >= 4 {
                output.push_str(&current);
                output.push('\n');
            }
            current.clear();
        }
    }
    if current.len() >= 4 {
        output.push_str(&current);
    }
    output
}

pub(crate) fn clean_pdf_text(text: &str) -> String {
    text.lines()
        .map(normalize_spaces)
        .filter(|line| !line.is_empty())
        .filter(|line| !is_pdf_noise_line(line))
        .collect::<Vec<_>>()
        .join("\n")
}

pub(crate) fn normalize_spaces(line: &str) -> String {
    line.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub(crate) fn is_pdf_noise_line(line: &str) -> bool {
    let lower = line.to_lowercase();
    if lower.is_empty() {
        return true;
    }
    let exact_noise = [
        "obj",
        "endobj",
        "stream",
        "endstream",
        "xref",
        "trailer",
        "startxref",
        "catalog",
    ];
    if exact_noise.contains(&lower.as_str()) {
        return true;
    }
    let contains_noise = [
        "/type",
        "/xobject",
        "flatedecode",
        "bbo",
        "bbox",
        "/resources",
        "/mediabox",
        "/contents",
        "/length",
        "/filter",
        "/font",
        "/procset",
        "endobj",
        "xref",
        "obj",
    ];
    if contains_noise.iter().any(|token| lower.contains(token)) {
        return true;
    }
    if lower.starts_with('%') || lower.starts_with("<<") || lower.starts_with(">>") {
        return true;
    }
    false
}

pub(crate) fn top_candidate_lines(text: &str, limit: usize) -> Vec<String> {
    text.lines()
        .map(normalize_spaces)
        .filter(|line| !line.is_empty())
        .take(limit)
        .collect()
}

pub(crate) fn choose_title(lines: &[String]) -> Option<ScoredLine> {
    lines
        .iter()
        .enumerate()
        .filter_map(|(index, line)| {
            let score = score_title_line(line, index);
            (score > 0).then(|| ScoredLine {
                index,
                line: line.clone(),
                score,
            })
        })
        .max_by(|a, b| compare_scored_lines(a, b))
}

pub(crate) fn choose_authors(lines: &[String], title_index: usize) -> Option<ScoredLine> {
    lines
        .iter()
        .enumerate()
        .filter(|(index, _)| *index > title_index && *index <= title_index + 4)
        .filter_map(|(index, line)| {
            let score = score_author_line(line, index.saturating_sub(title_index));
            (score > 0).then(|| ScoredLine {
                index,
                line: line.clone(),
                score,
            })
        })
        .max_by(|a, b| compare_scored_lines(a, b))
}

pub(crate) fn score_title_line(line: &str, index: usize) -> i32 {
    let len = line.chars().count();
    if !(12..=220).contains(&len) || !has_letter(line) {
        return -100;
    }
    if looks_like_author_list(line) {
        return -100;
    }
    let lower = line.to_lowercase();
    if lower.contains("doi")
        || lower.contains("abstract")
        || lower.contains("introduction")
        || lower.contains("references")
        || lower.contains("copyright")
        || lower.contains("arxiv:")
        || lower.contains('@')
    {
        return -100;
    }

    let mut score = 0;
    score += (40_i32 - (index as i32 * 4)).max(0);
    if (18..=140).contains(&len) {
        score += 24;
    }
    let words = line.split_whitespace().count();
    if (3..=18).contains(&words) {
        score += 18;
    }
    let alpha_ratio = line.chars().filter(|ch| ch.is_alphabetic()).count() as f32 / len as f32;
    if alpha_ratio > 0.55 {
        score += 18;
    }
    if line
        .chars()
        .all(|ch| !ch.is_lowercase() || !ch.is_alphabetic())
    {
        score -= 8;
    }
    if line.chars().any(|ch| ch.is_ascii_digit()) {
        score -= 6;
    }
    if line.contains(',') {
        score -= 10;
    }
    score
}

pub(crate) fn score_author_line(line: &str, distance_from_title: usize) -> i32 {
    let len = line.chars().count();
    if !(3..=180).contains(&len) || !has_letter(line) {
        return -100;
    }
    let lower = line.to_lowercase();
    if lower.contains("abstract")
        || lower.contains("introduction")
        || lower.contains("doi")
        || lower.contains("copyright")
        || lower.contains("university")
        || lower.contains("department")
        || lower.contains("school")
        || lower.contains("institute")
        || lower.contains("keywords")
    {
        return -100;
    }
    if !looks_like_author_list(line) {
        return -100;
    }

    let mut score = 0;
    score += (28_i32 - distance_from_title as i32 * 6).max(0);
    if line.contains(',') || line.contains(" and ") {
        score += 14;
    }
    if lower.contains("et al") {
        score += 10;
    }
    if line.contains('@') {
        score -= 10;
    }
    let words = line.split_whitespace().count();
    if (2..=16).contains(&words) {
        score += 12;
    }
    score
}

pub(crate) fn compare_scored_lines(a: &ScoredLine, b: &ScoredLine) -> Ordering {
    a.score.cmp(&b.score).then_with(|| b.index.cmp(&a.index))
}

pub(crate) fn has_letter(line: &str) -> bool {
    line.chars().any(|ch| ch.is_alphabetic())
}

pub(crate) fn looks_like_author_list(line: &str) -> bool {
    let lower = line.to_lowercase();
    if lower.contains("et al") || lower.contains(" and ") {
        return true;
    }
    if !line.contains(',') {
        return false;
    }
    let parts: Vec<&str> = line
        .split(',')
        .map(|part| part.trim())
        .filter(|part| !part.is_empty())
        .collect();
    if parts.len() < 2 {
        return false;
    }
    parts.iter().all(|part| {
        let words: Vec<&str> = part.split_whitespace().collect();
        (1..=4).contains(&words.len())
            && words.iter().all(|word| {
                word.chars()
                    .next()
                    .map(|ch| ch.is_uppercase())
                    .unwrap_or(false)
            })
    })
}

pub(crate) fn find_doi(text: &str) -> Option<String> {
    let lowered = text.to_lowercase();
    let start = lowered.find("10.")?;
    let tail = &text[start..text.len().min(start + 220)];
    let candidate = tail
        .split_whitespace()
        .next()
        .unwrap_or("")
        .trim_matches(|ch: char| {
            matches!(
                ch,
                '"' | '\'' | '(' | ')' | '[' | ']' | '{' | '}' | ',' | ';' | '.'
            )
        });
    if candidate.starts_with("10.") && candidate.contains('/') && candidate.len() >= 7 {
        Some(candidate.to_string())
    } else {
        None
    }
}

pub(crate) fn find_year_near_top(text: &str) -> Option<i64> {
    let window = text.lines().take(40).collect::<Vec<_>>().join(" ");
    find_year_anywhere(&window)
}

pub(crate) fn find_year_anywhere(text: &str) -> Option<i64> {
    for token in text.split(|ch: char| !ch.is_ascii_alphanumeric()) {
        if token.len() == 4 {
            if let Ok(year) = token.parse::<i64>() {
                if (1900..=2100).contains(&year) {
                    return Some(year);
                }
            }
        }
    }
    None
}
