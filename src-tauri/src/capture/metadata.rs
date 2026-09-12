//! Identifier-only enrichment. Never guess a match by title or overwrite page fields.
use serde_json::{json,Value};
fn empty(v:&Value)->bool { v.is_null() || v.as_str().is_some_and(|s|s.trim().is_empty()) || v.as_array().is_some_and(|a|a.is_empty()) }
fn plain(s:&str)->String {
    let mut tag=false;let mut result=String::new();
    for ch in s.chars().take(60000) { if ch=='<' {tag=true;} else if ch=='>' {tag=false;result.push(' ');} else if !tag {result.push(ch);} }
    result.replace("&lt;","<").replace("&gt;",">").replace("&amp;","&").split_whitespace().collect::<Vec<_>>().join(" ")
}
fn field(envelope:&mut Value,path:&[&str],value:Value,source:&str) {
    if empty(&value) {return;}
    let mut cursor=&mut envelope["metadata"];
    for key in path {if !cursor.is_object(){*cursor=json!({});}cursor=&mut cursor[*key];}
    let selected=empty(cursor);if selected {*cursor=value.clone();}
    if let Some(e)=envelope["evidence"].as_array_mut(){e.push(json!({"field":path.join("."),"value":value,"source":source,"method":"identifier_api","selected":selected,"capturedAt":chrono::DateTime::<chrono::Utc>::from(std::time::SystemTime::now()).to_rfc3339()}));}
}
fn date(value:&Value)->Value {
    let Some(parts)=value["date-parts"][0].as_array() else{return Value::Null;};
    let Some(year)=parts.first().and_then(Value::as_u64).filter(|y|(1000..=9999).contains(y)) else{return Value::Null;};
    let mut s=year.to_string();
    if let Some(month)=parts.get(1).and_then(Value::as_u64).filter(|m|(1..=12).contains(m)){s.push_str(&format!("-{month:02}"));
        if let Some(day)=parts.get(2).and_then(Value::as_u64).filter(|d|(1..=31).contains(d)){s.push_str(&format!("-{day:02}"));}}
    json!(s)
}
pub fn apply_crossref(envelope:&mut Value,response:&Value,source:&str)->Result<(),String>{
    let m=&response["message"];
    let doi=envelope["metadata"]["identifiers"]["doi"].as_str().unwrap_or("");
    if doi.is_empty() || !m["DOI"].as_str().is_some_and(|d|d.eq_ignore_ascii_case(doi)) {return Err("crossref_identifier_mismatch".into());}
    field(envelope,&["title"],m["title"][0].clone(),source);
    field(envelope,&["abstract"],m["abstract"].as_str().map(|s|json!(plain(s))).unwrap_or(Value::Null),source);
    field(envelope,&["publication","venue"],m["container-title"][0].clone(),source);
    for key in ["publisher","volume","issue"]{field(envelope,&["publication",key],m[key].clone(),source);}
    field(envelope,&["publication","issn"],m["ISSN"][0].clone(),source);
    field(envelope,&["publication","pages"],m["page"].clone(),source);
    field(envelope,&["dates","online"],date(&m["published-online"]),source);
    field(envelope,&["dates","print"],date(&m["published-print"]),source);
    field(envelope,&["dates","published"],date(&m["published"]),source);
    let authors=m["author"].as_array().map(|rows|rows.iter().map(|a|json!({"name":format!("{} {}",a["given"].as_str().unwrap_or(""),a["family"].as_str().unwrap_or("")).trim(),"orcid":a["ORCID"],"affiliations":a["affiliation"].as_array().map(|v|v.iter().filter_map(|x|x["name"].as_str()).collect::<Vec<_>>()).unwrap_or_default()})).collect::<Vec<_>>()).unwrap_or_default();
    field(envelope,&["authors"],json!(authors),source);
    if !envelope["raw"].is_object(){envelope["raw"]=json!({});}
    if !envelope["raw"]["providers"].is_object(){envelope["raw"]["providers"]=json!({});}
    envelope["raw"]["providers"]["crossref"]=m.clone();
    Ok(())
}
pub fn apply_europepmc(envelope:&mut Value,response:&Value,source:&str)->Result<(),String>{
    let m=&response["resultList"]["result"][0];
    let pmcid=envelope["metadata"]["identifiers"]["pmcid"].as_str().unwrap_or("");
    if pmcid.is_empty() || m["pmcid"]!=pmcid {return Err("europepmc_identifier_mismatch".into());}
    field(envelope,&["title"],m["title"].clone(),source);
    field(envelope,&["abstract"],m["abstractText"].as_str().map(|s|json!(plain(s))).unwrap_or(Value::Null),source);
    field(envelope,&["identifiers","doi"],m["doi"].clone(),source);
    field(envelope,&["identifiers","pmid"],m["pmid"].clone(),source);
    field(envelope,&["publication","venue"],m["journalInfo"]["journal"]["title"].clone(),source);
    field(envelope,&["dates","published"],m["firstPublicationDate"].clone(),source);
    let authors=m["authorList"]["author"].as_array().map(|a|a.iter().map(|a|json!({"name":a["fullName"],"affiliations":a["authorAffiliationDetailsList"]["authorAffiliation"].as_array().map(|rows|rows.iter().filter_map(|a|a["affiliation"].as_str()).collect::<Vec<_>>()).unwrap_or_default()})).collect::<Vec<_>>()).unwrap_or_default();
    field(envelope,&["authors"],json!(authors),source);
    if !envelope["raw"]["providers"].is_object(){envelope["raw"]["providers"]=json!({});}
    envelope["raw"]["providers"]["europepmc"]=m.clone();Ok(())
}
pub fn enrich(envelope:&mut Value,cancel:&impl Fn()->bool){
    if envelope["raw"]["providers"].is_object(){return;}
    let pmcid=envelope["metadata"]["identifiers"]["pmcid"].as_str().unwrap_or("").to_string();
    if pmcid.starts_with("PMC") && pmcid[3..].chars().all(|c|c.is_ascii_digit()) && pmcid.len()>3 && pmcid.len()<24 {
        let mut url=reqwest::Url::parse("https://www.ebi.ac.uk/europepmc/webservices/rest/search").unwrap();
        url.query_pairs_mut().append_pair("query",&format!("PMCID:{pmcid}")).append_pair("format","json").append_pair("resultType","core").append_pair("pageSize","1");
        if let Err(e)=super::download::public_json(url.as_str(),cancel).and_then(|v|apply_europepmc(envelope,&v,url.as_str())){warn(envelope,&e);}
    }
    let doi=envelope["metadata"]["identifiers"]["doi"].as_str().unwrap_or("").to_string();
    if doi.starts_with("10.") && doi.contains('/') && doi.len()<512 && !cancel(){
        let mut url=reqwest::Url::parse("https://api.crossref.org/works/").unwrap();url.path_segments_mut().unwrap().pop_if_empty().push(&doi);
        if let Err(e)=super::download::public_json(url.as_str(),cancel).and_then(|v|apply_crossref(envelope,&v,url.as_str())){warn(envelope,&e);}
    }
}
fn warn(envelope:&mut Value,error:&str){if let Some(w)=envelope["warnings"].as_array_mut(){w.push(json!(format!("外部元数据未补全：{error}")));}}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]fn capture_provider_requires_exact_identifier_and_preserves_page_fields(){
        let mut e=super::super::model::fixture();e["metadata"]["identifiers"]["doi"]=json!("10.1000/valid");
        let response=json!({"message":{"DOI":"10.1000/wrong","title":["Wrong"]}});assert!(apply_crossref(&mut e,&response,"fixture").is_err());
        let response=json!({"message":{"DOI":"10.1000/valid","title":["Provider title"],"abstract":"<jats:p>Full &amp; safe</jats:p>","published-online":{"date-parts":[[2020,2]]}}});
        apply_crossref(&mut e,&response,"fixture").unwrap();assert_eq!(e["metadata"]["title"],"Fixture");assert_eq!(e["metadata"]["abstract"],"Full & safe");assert_eq!(e["metadata"]["dates"]["online"],"2020-02");assert!(!e["raw"]["providers"]["crossref"].is_null());
    }
}
